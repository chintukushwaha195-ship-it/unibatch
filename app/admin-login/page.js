'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, LogIn, KeyRound, ArrowLeft } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

export default function AdminLoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      localStorage.setItem('unibatch_admin_token', data.token);
      toast.success('Signed in');
      router.push('/admin');
    } catch (err) {
      toast.error(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const recover = async () => {
    try {
      const res = await fetch('/api/admin/recovery', { method: 'POST' });
      const data = await res.json();
      if (data.ok) toast.success(`Recovery email sent to ${data.sentTo} (MOCKED)`);
      else toast.error(data.error || 'Failed');
    } catch (err) { toast.error(err.message); }
  };

  return (
    <div className="min-h-screen text-white flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <Link href="/" className="inline-flex items-center gap-2 text-sky-300 hover:text-sky-200 mb-6">
          <ArrowLeft className="w-4 h-4" /> Back to site
        </Link>
        <Card className="glass border-white/10 rounded-3xl glow-cyan">
          <CardContent className="p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-sky-400 to-gold-400 flex items-center justify-center font-bold text-navy-950">U</div>
              <div>
                <div className="text-xs uppercase tracking-widest text-white/50">UNIBATCH</div>
                <div className="font-bold text-lg">Admin Panel</div>
              </div>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <Label htmlFor="u" className="text-xs text-white/60">Username</Label>
                <Input id="u" value={username} onChange={(e) => setUsername(e.target.value)} className="mt-1 bg-white/5 border-white/10 rounded-xl" autoComplete="username" />
              </div>
              <div>
                <Label htmlFor="p" className="text-xs text-white/60">Password</Label>
                <Input id="p" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 bg-white/5 border-white/10 rounded-xl" autoComplete="current-password" />
              </div>
              <Button type="submit" disabled={loading} className="w-full rounded-xl bg-gradient-to-r from-sky-500 to-cyan-400 text-navy-950 font-semibold hover:opacity-90 h-11">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><LogIn className="w-4 h-4 mr-2" /> Sign in</>}
              </Button>
            </form>
            <button onClick={recover} className="mt-4 w-full text-xs text-white/50 hover:text-sky-300 inline-flex items-center justify-center gap-1">
              <KeyRound className="w-3 h-3" /> Forgot password? Recover via recovery email
            </button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
