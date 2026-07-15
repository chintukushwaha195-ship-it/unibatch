'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, LogIn, KeyRound, ArrowLeft, ShieldCheck } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

/**
 * Compute a browser fingerprint using only built-in Web APIs — no external library.
 * The hash is derived client-side and sent to the server, where it is combined with
 * the server-observed IP address to form the device key used for rate-limiting.
 */
async function computeFingerprint() {
  try {
    const components = [
      navigator.userAgent || '',
      navigator.language || '',
      (navigator.languages || []).join(','),
      Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      `${screen.width}x${screen.height}x${screen.colorDepth}`,
      navigator.platform || '',
      String(navigator.hardwareConcurrency || 0),
      String(navigator.deviceMemory || 0),
      navigator.cookieEnabled ? '1' : '0',
      navigator.doNotTrack || '',
    ].join('|');

    const encoder = new TextEncoder();
    const data = encoder.encode(components);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // Fallback: empty string — server will still use IP for rate-limiting
    return '';
  }
}

export default function AdminLoginPage() {
  const router = useRouter();

  // Step 1: password
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // Step 2: OTP
  const [step, setStep] = useState('password'); // 'password' | 'otp'
  const [otp, setOtp] = useState('');
  const [sentTo, setSentTo] = useState('');

  const [loading, setLoading] = useState(false);
  const fingerprintRef = useRef('');

  // Pre-compute fingerprint once on mount so it's ready when the form submits
  useEffect(() => {
    computeFingerprint().then((fp) => { fingerprintRef.current = fp; });
  }, []);

  // If already authenticated, redirect immediately
  useEffect(() => {
    fetch('/api/admin/me', { credentials: 'include' })
      .then((r) => { if (r.ok) router.replace('/admin'); })
      .catch(() => {});
  }, [router]);

  // ---------- Step 1: submit username + password ----------
  const submitPassword = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          fingerprint: fingerprintRef.current,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Login failed');
        return;
      }
      if (data.step === 'otp') {
        setSentTo(data.sentTo || '');
        setStep('otp');
        toast.success(`Verification code sent${data.sentTo ? ' to ' + data.sentTo : ''}`);
      }
    } catch (err) {
      toast.error('Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ---------- Step 2: submit OTP ----------
  const submitOtp = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/admin/verify-otp', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          otp: otp.trim(),
          fingerprint: fingerprintRef.current,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Verification failed');
        if (res.status === 429) setStep('password'); // block → back to start
        return;
      }
      toast.success('Signed in');
      router.push('/admin');
    } catch (err) {
      toast.error('Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ---------- Resend OTP (re-submit password silently) ----------
  const resendOtp = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, fingerprint: fingerprintRef.current }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Could not resend code');
        setStep('password');
        return;
      }
      setOtp('');
      toast.success('A new code has been sent');
    } catch {
      toast.error('Connection error');
    } finally {
      setLoading(false);
    }
  };

  // ---------- Password recovery ----------
  const recover = async () => {
  try {
    const res = await fetch('/api/admin/recovery', { method: 'POST' });
    const data = await res.json();
    if (data.ok) toast.success('Recovery instructions sent to your registered email.');
    else toast.error(data.error || 'Failed to send recovery email');
  } catch (err) {
    toast.error('Connection error');
  }
};

  return (
    <div className="min-h-screen text-white flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <Link href="/" className="inline-flex items-center gap-2 text-sky-300 hover:text-sky-200 mb-6">
          <ArrowLeft className="w-4 h-4" /> Back to site
        </Link>

        <Card className="glass border-white/10 rounded-3xl glow-cyan">
          <CardContent className="p-8">
            {/* Header */}
            <div className="flex items-center gap-3 mb-6">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-sky-400 to-gold-400 flex items-center justify-center font-bold text-navy-950">U</div>
              <div>
                <div className="text-xs uppercase tracking-widest text-white/50">UNIBATCH</div>
                <div className="font-bold text-lg">Admin Panel</div>
              </div>
            </div>

            {/* Step 1: Password */}
            {step === 'password' && (
              <form onSubmit={submitPassword} className="space-y-4">
                <div>
                  <Label htmlFor="u" className="text-xs text-white/60">Username</Label>
                  <Input
                    id="u"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="mt-1 bg-white/5 border-white/10 rounded-xl"
                    autoComplete="username"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="p" className="text-xs text-white/60">Password</Label>
                  <Input
                    id="p"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="mt-1 bg-white/5 border-white/10 rounded-xl"
                    autoComplete="current-password"
                    required
                  />
                </div>
                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-xl bg-gradient-to-r from-sky-500 to-cyan-400 text-navy-950 font-semibold hover:opacity-90 h-11"
                >
                  {loading
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <><LogIn className="w-4 h-4 mr-2" /> Sign in</>
                  }
                </Button>

                <button
                  type="button"
                  onClick={recover}
                  className="mt-4 w-full text-xs text-white/50 hover:text-sky-300 inline-flex items-center justify-center gap-1"
                >
                  <KeyRound className="w-3 h-3" /> Forgot password? Send recovery instructions
                </button>
              </form>
            )}

            {/* Step 2: OTP */}
            {step === 'otp' && (
              <form onSubmit={submitOtp} className="space-y-4">
                <div className="rounded-xl bg-sky-500/10 border border-sky-400/20 p-4 text-sm text-sky-200 flex items-start gap-3">
                  <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5 text-sky-400" />
                  <div>
                    <div className="font-semibold mb-0.5">Two-step verification</div>
                    <div className="text-sky-300/70 text-xs">
                      A 6-digit code was sent to{sentTo ? ` ${sentTo}` : ' your recovery email'}. It expires in 1 minute.
                    </div>
                  </div>
                </div>

                <div>
                  <Label htmlFor="otp" className="text-xs text-white/60">Verification code</Label>
                  <Input
                    id="otp"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="mt-1 bg-white/5 border-white/10 rounded-xl text-center tracking-[0.4em] text-xl font-mono"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    required
                    autoFocus
                  />
                </div>

                <Button
                  type="submit"
                  disabled={loading || otp.length !== 6}
                  className="w-full rounded-xl bg-gradient-to-r from-sky-500 to-cyan-400 text-navy-950 font-semibold hover:opacity-90 h-11"
                >
                  {loading
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <><ShieldCheck className="w-4 h-4 mr-2" /> Verify & sign in</>
                  }
                </Button>

                <div className="flex items-center justify-between text-xs text-white/40 pt-1">
                  <button
                    type="button"
                    onClick={() => { setStep('password'); setOtp(''); }}
                    className="hover:text-white/70"
                  >
                    ← Back
                  </button>
                  <button
                    type="button"
                    onClick={resendOtp}
                    disabled={loading}
                    className="hover:text-sky-300"
                  >
                    Resend code
                  </button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
