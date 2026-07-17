'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  LogOut, Check, EyeOff, Star, StarOff, ArrowLeft,
  Wallet, Target, Users, TrendingUp, ExternalLink, Loader2,
  Save, Trash2, Plus, Eye, Mail, Send
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

/**
 * All admin API calls use credentials:'include' so the Secure HttpOnly
 * session cookie is sent automatically — no token stored in localStorage.
 */
const authFetch = (url, opts = {}) => fetch(url, {
  ...opts,
  credentials: 'include',
  headers: { ...(opts.headers || {}), 'Content-Type': 'application/json' },
});

export default function AdminDashboard() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [stats, setStats] = useState(null);
  const [contribs, setContribs] = useState([]);
  const [content, setContent] = useState(null);
  const [wallets, setWallets] = useState([]);
  const [primaryWallet, setPrimaryWallet] = useState('');
  const [newGoal, setNewGoal] = useState('');
  const [newWallet, setNewWallet] = useState({ label: '', network: '', address: '' });
  const [saving, setSaving] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const [s, c, ct, w] = await Promise.all([
        authFetch('/api/admin/stats').then((r) => r.json()),
        authFetch('/api/admin/contributors').then((r) => r.json()),
        fetch('/api/content', { cache: 'no-store' }).then((r) => r.json()),
        authFetch('/api/admin/wallets').then((r) => r.json()),
      ]);
      setStats(s);
      setContribs(c.contributors || []);
      setContent(ct);
      setWallets(w.wallets || []);
      setPrimaryWallet(w.primaryWallet || '');
      setNewGoal(String(s.goal || 250));
    } catch (e) {
      toast.error('Failed to load admin data');
    }
  }, []);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/admin/me', { credentials: 'include' });
      if (!res.ok) return router.replace('/admin-login');
      setReady(true);
      loadAll();
    })();
  }, [router, loadAll]);

  const logout = async () => {
    try {
      await fetch('/api/admin/logout', { method: 'POST', credentials: 'include' });
    } catch { /* ignore */ }
    router.replace('/admin-login');
  };

  const patchContrib = async (id, patch) => {
    try {
      const res = await authFetch(`/api/admin/contributors/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.warning) toast.error(data.warning);
      else toast.success('Updated');
      loadAll();
    } catch (e) { toast.error(e.message); }
  };

  const mailContrib = async (id, { subject, message }) => {
    const res = await authFetch(`/api/admin/contributors/${id}/mail`, { method: 'POST', body: JSON.stringify({ subject, message }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to send');
    toast.success(data.message || 'Email sent');
  };

  const saveGoal = async () => {
    try {
      const res = await authFetch('/api/admin/goal', { method: 'PATCH', body: JSON.stringify({ goal: parseFloat(newGoal) }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Goal set to $${data.goal}`);
      loadAll();
    } catch (e) { toast.error(e.message); }
  };

  const savePrimaryWallet = async () => {
    try {
      const res = await authFetch('/api/admin/primary-wallet', { method: 'PATCH', body: JSON.stringify({ address: primaryWallet }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success('Primary wallet updated. Next sync will use it.');
      loadAll();
    } catch (e) { toast.error(e.message); }
  };

  const addWallet = async () => {
    if (!newWallet.address || !newWallet.network) return toast.error('Network + address required');
    try {
      const res = await authFetch('/api/admin/wallets', { method: 'POST', body: JSON.stringify(newWallet) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success('Wallet added');
      setNewWallet({ label: '', network: '', address: '' });
      loadAll();
    } catch (e) { toast.error(e.message); }
  };

  const deleteWallet = async (id) => {
    try {
      await authFetch(`/api/admin/wallets/${id}`, { method: 'DELETE' });
      toast.success('Removed');
      loadAll();
    } catch (e) { toast.error(e.message); }
  };

  const saveContent = async (section, value) => {
    setSaving(true);
    try {
      const res = await authFetch('/api/admin/content', { method: 'PATCH', body: JSON.stringify({ [section]: value }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`${section} saved`);
      loadAll();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  if (!ready) return <div className="min-h-screen flex items-center justify-center text-white/60"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  return (
    <div className="min-h-screen text-white">
      <header className="border-b border-white/10 backdrop-blur-lg sticky top-0 z-40 bg-navy-950/60">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-white/50 hover:text-white text-sm inline-flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> Site</Link>
            <div className="w-px h-6 bg-white/10" />
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-400 to-gold-400 flex items-center justify-center font-bold text-navy-950 text-sm">U</div>
            <div>
              <div className="text-sm font-bold">UNIBATCH Admin</div>
              <div className="text-[10px] text-white/50 uppercase tracking-widest">Dashboard</div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={logout} variant="outline" size="sm" className="rounded-full border-rose-400/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-200">
              <LogOut className="w-4 h-4 mr-1" /> Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatBox icon={Target} label="Goal" value={`$${stats?.goal ?? '—'}`} />
          <StatBox icon={TrendingUp} label="Raised" value={`$${stats?.raised ?? 0}`} accent="gold" />
          <StatBox icon={Users} label="Backers" value={stats?.count ?? 0} />
          <StatBox icon={Wallet} label="Pending" value={stats?.pending ?? 0} accent="cyan" />
        </div>
        <Card className="glass border-white/10 rounded-2xl mb-8">
          <CardContent className="p-5">
            <div className="flex flex-wrap items-end justify-between gap-2 mb-2">
              <div className="text-sm text-white/60">Progress</div>
              <div className="text-xs text-white/50">
                {stats?.progress?.toFixed?.(1) ?? 0}% · {stats?.onchain ?? 0} on-chain · {stats?.formCount ?? 0} form · {stats?.hiddenCount ?? 0} hidden
              </div>
            </div>
            <Progress value={stats?.progress || 0} className="h-2 bg-white/5" />
            <div className="mt-3 text-xs text-white/40">
              Last sync: {stats?.lastSyncAt ? new Date(stats.lastSyncAt).toLocaleString() : 'never'}
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="contributors" className="w-full">
          <TabsList className="glass rounded-full h-auto p-1 flex-wrap">
            <TabsTrigger value="contributors" className="rounded-full data-[state=active]:bg-sky-500 data-[state=active]:text-navy-950">Contributors</TabsTrigger>
            <TabsTrigger value="content" className="rounded-full data-[state=active]:bg-sky-500 data-[state=active]:text-navy-950">Content</TabsTrigger>
            <TabsTrigger value="wallets" className="rounded-full data-[state=active]:bg-sky-500 data-[state=active]:text-navy-950">Wallets & Goal</TabsTrigger>
            <TabsTrigger value="transparency" className="rounded-full data-[state=active]:bg-sky-500 data-[state=active]:text-navy-950">Transparency</TabsTrigger>
            <TabsTrigger value="faq" className="rounded-full data-[state=active]:bg-sky-500 data-[state=active]:text-navy-950">FAQ</TabsTrigger>
          </TabsList>

          <TabsContent value="contributors" className="mt-4">
            <Card className="glass border-white/10 rounded-2xl">
              <CardContent className="p-4">
                <div className="text-sm text-white/60 mb-3">Approve to reveal name on the public wall · Highlight to pin · Hide to remove entirely.</div>
                <div className="space-y-2">
                  {contribs.length === 0 && <div className="text-white/40 text-sm py-8 text-center">No contributions yet.</div>}
                  {contribs.map((c) => (
                    <div key={c.id} className="rounded-xl bg-white/5 border border-white/10 p-3 flex flex-wrap items-center gap-3">
                      <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-sky-500/30 to-gold-400/20 flex items-center justify-center font-mono text-[11px] text-sky-200 border border-white/10">
                        {c.displayId}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-white">{c.name || c.nickname || <span className="text-white/40 italic">unnamed</span>}</span>
                          <Badge className={c.source === 'onchain' ? 'bg-cyan-500/15 text-cyan-300 border-cyan-400/30' : 'bg-sky-500/15 text-sky-300 border-sky-400/30'}>{c.source}</Badge>
                          {c.verified === false && <Badge className="bg-amber-500/15 text-amber-300 border-amber-400/30">unverified — check before approving</Badge>}
                          {c.approved && <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-400/30">approved</Badge>}
                          {c.highlighted && <Badge className="bg-gold-400/15 text-gold-400 border-gold-400/30">pinned</Badge>}
                          {c.hidden && <Badge className="bg-rose-500/15 text-rose-300 border-rose-400/30">hidden</Badge>}
                        </div>
                        {/* ✅ EMAIL ADDED HERE */}
                        <div className="text-[11px] text-white/50 mt-0.5">
                          📧 {c.email || 'No email'}
                        </div>
                        <div className="text-[11px] text-white/50 mt-0.5">
                          ${Number(c.amount).toFixed(2)} · {c.session} UTC · {new Date(c.createdAt).toLocaleString()}
                          {c.txHash && (
                            <> · <a href={`https://bscscan.com/tx/${c.txHash}`} target="_blank" rel="noreferrer" className="text-cyan-300 inline-flex items-center gap-0.5">tx <ExternalLink className="w-3 h-3" /></a></>
                          )}
                        </div>
                        {c.verified === false && (
                          <TxLinkRow contributorId={c.id} onLink={(txHash) => patchContrib(c.id, { txHash })} />
                        )}
                      </div>
                      <div className="flex gap-1">
                        <MailComposeButton contributor={c} onSend={mailContrib} />
                        <Button size="sm" variant="outline" onClick={() => patchContrib(c.id, { approved: !c.approved })}
                          className="rounded-lg border-white/15 bg-white/5 hover:bg-white/10">
                          {c.approved ? <><EyeOff className="w-3.5 h-3.5 mr-1" /> Unapprove</> : <><Check className="w-3.5 h-3.5 mr-1" /> Approve</>}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => patchContrib(c.id, { highlighted: !c.highlighted })}
                          className="rounded-lg border-white/15 bg-white/5 hover:bg-white/10">
                          {c.highlighted ? <StarOff className="w-3.5 h-3.5" /> : <Star className="w-3.5 h-3.5" />}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => patchContrib(c.id, { hidden: !c.hidden })}
                          className="rounded-lg border-rose-400/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-200">
                          {c.hidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="content" className="mt-4 space-y-4">
            <AboutEditor content={content} onSave={(v) => saveContent('about', v)} saving={saving} />
            <StrategyEditor content={content} onSave={(v) => saveContent('strategy', v)} saving={saving} />
          </TabsContent>

          <TabsContent value="wallets" className="mt-4 space-y-4">
            <Card className="glass border-white/10 rounded-2xl">
              <CardContent className="p-5 space-y-4">
                <div>
                  <div className="text-sm font-semibold text-white mb-2">Goal amount</div>
                  <div className="flex gap-2">
                    <Input type="number" value={newGoal} onChange={(e) => setNewGoal(e.target.value)} className="bg-white/5 border-white/10 rounded-xl max-w-[200px]" />
                    <Button onClick={saveGoal} className="rounded-xl bg-sky-500 text-navy-950 hover:bg-sky-400"><Save className="w-4 h-4 mr-1" /> Save</Button>
                  </div>
                </div>
                <div>
                  <div className="text-sm font-semibold text-white mb-2">Primary polled wallet (USDT · BEP20)</div>
                  <div className="flex gap-2">
                    <Input value={primaryWallet} onChange={(e) => setPrimaryWallet(e.target.value)} className="bg-white/5 border-white/10 rounded-xl font-mono text-xs" />
                    <Button onClick={savePrimaryWallet} className="rounded-xl bg-sky-500 text-navy-950 hover:bg-sky-400"><Save className="w-4 h-4 mr-1" /> Save</Button>
                  </div>
                  <div className="text-[11px] text-white/40 mt-1">Changing this resets the sync cursor to the last ~10 min.</div>
                </div>
              </CardContent>
            </Card>

            <Card className="glass border-white/10 rounded-2xl">
              <CardContent className="p-5">
                <div className="text-sm font-semibold text-white mb-3">Additional wallets (display only)</div>
                <div className="space-y-2 mb-4">
                  {wallets.length === 0 && <div className="text-white/40 text-xs">None yet.</div>}
                  {wallets.map((w) => (
                    <div key={w.id} className="rounded-lg bg-white/5 border border-white/10 p-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-white">{w.label || w.network}</div>
                        <div className="text-[11px] text-white/50 font-mono truncate">{w.network} · {w.address}</div>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => deleteWallet(w.id)}
                        className="rounded-lg border-rose-400/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-200"><Trash2 className="w-3.5 h-3.5" /></Button>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <Input placeholder="Label (e.g. Solana USDC)" value={newWallet.label} onChange={(e) => setNewWallet({ ...newWallet, label: e.target.value })} className="bg-white/5 border-white/10 rounded-xl" />
                  <Input placeholder="Network (e.g. SOL SPL)" value={newWallet.network} onChange={(e) => setNewWallet({ ...newWallet, network: e.target.value })} className="bg-white/5 border-white/10 rounded-xl" />
                  <Input placeholder="Address" value={newWallet.address} onChange={(e) => setNewWallet({ ...newWallet, address: e.target.value })} className="bg-white/5 border-white/10 rounded-xl font-mono text-xs" />
                </div>
                <Button onClick={addWallet} className="mt-3 rounded-xl bg-gradient-to-r from-sky-500 to-cyan-400 text-navy-950"><Plus className="w-4 h-4 mr-1" /> Add wallet</Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="transparency" className="mt-4">
            <TransparencyEditor content={content} onSave={(v) => saveContent('transparency', v)} saving={saving} />
          </TabsContent>

          <TabsContent value="faq" className="mt-4">
            <FaqEditor content={content} onSave={(v) => saveContent('faq', v)} saving={saving} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function StatBox({ icon: Icon, label, value, accent }) {
  return (
    <Card className="glass border-white/10 rounded-2xl">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-white/50 text-xs">
          <Icon className="w-3.5 h-3.5" /> {label}
        </div>
        <div className={`mt-1 text-2xl font-bold ${accent === 'gold' ? 'text-gold-400' : accent === 'cyan' ? 'text-cyan-300' : 'text-white'}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function AboutEditor({ content, onSave, saving }) {
  const [local, setLocal] = useState(null);
  useEffect(() => {
    if (!content?.about) return;
    const src = content.about;
    // Defensive defaults — if `about` was ever saved by the old mismatched
    // editor, `intro` may be missing entirely. Never let the form crash on
    // that; just start those fields blank instead of losing the chapters.
    setLocal({
      intro: {
        fullName:   src.intro?.fullName   || '',
        location:   src.intro?.location   || '',
        experience: src.intro?.experience || '',
        markets:    src.intro?.markets    || '',
        milestones: src.intro?.milestones || '',
        motivation: src.intro?.motivation || '',
      },
      chapters: Array.isArray(src.chapters)
        ? src.chapters.map((c, i) => ({ letter: c.letter || String.fromCharCode(97 + i), title: c.title || '', body: c.body || '' }))
        : [],
    });
  }, [content]);
  if (!local) return null;

  const setIntro = (key, val) => setLocal({ ...local, intro: { ...local.intro, [key]: val } });
  const setChapter = (i, key, val) => {
    const c = [...local.chapters];
    c[i] = { ...c[i], [key]: val };
    setLocal({ ...local, chapters: c });
  };
  const addChapter = () => setLocal({ ...local, chapters: [...local.chapters, { letter: String.fromCharCode(97 + local.chapters.length), title: '', body: '' }] });
  const removeChapter = (i) => setLocal({ ...local, chapters: local.chapters.filter((_, idx) => idx !== i) });

  return (
    <Card className="glass border-white/10 rounded-2xl">
      <CardContent className="p-5 space-y-3">
        <div className="text-sm font-semibold text-white">About Me</div>

        <div className="text-xs uppercase tracking-widest text-white/40 pt-1">Intro card (shown at the top of the About page)</div>
        <div className="grid sm:grid-cols-2 gap-2">
          <div><Label className="text-xs text-white/60">Full name</Label>
            <Input value={local.intro.fullName} onChange={(e) => setIntro('fullName', e.target.value)} className="mt-1 bg-white/5 border-white/10 rounded-xl" /></div>
          <div><Label className="text-xs text-white/60">Location</Label>
            <Input value={local.intro.location} onChange={(e) => setIntro('location', e.target.value)} className="mt-1 bg-white/5 border-white/10 rounded-xl" /></div>
          <div><Label className="text-xs text-white/60">Experience</Label>
            <Input value={local.intro.experience} onChange={(e) => setIntro('experience', e.target.value)} className="mt-1 bg-white/5 border-white/10 rounded-xl" /></div>
          <div><Label className="text-xs text-white/60">Markets I trade</Label>
            <Input value={local.intro.markets} onChange={(e) => setIntro('markets', e.target.value)} className="mt-1 bg-white/5 border-white/10 rounded-xl" /></div>
        </div>
        <div><Label className="text-xs text-white/60">Milestone</Label>
          <Textarea value={local.intro.milestones} onChange={(e) => setIntro('milestones', e.target.value)} className="mt-1 bg-white/5 border-white/10 rounded-xl" rows={3} /></div>
        <div><Label className="text-xs text-white/60">Personal motivation</Label>
          <Textarea value={local.intro.motivation} onChange={(e) => setIntro('motivation', e.target.value)} className="mt-1 bg-white/5 border-white/10 rounded-xl" rows={3} /></div>

        <div className="text-xs uppercase tracking-widest text-white/40 pt-3">Trading journey chapters</div>
        {local.chapters.map((ch, i) => (
          <div key={i} className="rounded-lg bg-white/5 border border-white/10 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 shrink-0 rounded-lg bg-white/10 flex items-center justify-center text-xs font-bold uppercase text-sky-200">{ch.letter}</div>
              <Input value={ch.title} onChange={(e) => setChapter(i, 'title', e.target.value)} placeholder="Chapter title" className="bg-white/5 border-white/10 rounded-xl font-semibold flex-1" />
              <Button size="sm" variant="outline" onClick={() => removeChapter(i)} className="rounded-lg border-rose-400/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-200 shrink-0"><Trash2 className="w-3.5 h-3.5" /></Button>
            </div>
            <Textarea value={ch.body} onChange={(e) => setChapter(i, 'body', e.target.value)} className="bg-white/5 border-white/10 rounded-xl" rows={5} />
          </div>
        ))}
        <Button onClick={addChapter} variant="outline" className="rounded-xl border-white/15 bg-white/5 hover:bg-white/10 text-white"><Plus className="w-4 h-4 mr-1" /> Add chapter</Button>

        <Button onClick={() => onSave(local)} disabled={saving} className="rounded-xl bg-sky-500 text-navy-950 hover:bg-sky-400"><Save className="w-4 h-4 mr-1" /> Save About</Button>
      </CardContent>
    </Card>
  );
}

function StrategyEditor({ content, onSave, saving }) {
  const [local, setLocal] = useState(null);
  useEffect(() => { if (content?.strategy) setLocal(JSON.parse(JSON.stringify(content.strategy))); }, [content]);
  if (!local) return null;
  return (
    <Card className="glass border-white/10 rounded-2xl">
      <CardContent className="p-5 space-y-3">
        <div className="text-sm font-semibold text-white">Strategy</div>
        <div>
          <Label className="text-xs text-white/60">Intro</Label>
          <Input value={local.intro} onChange={(e) => setLocal({ ...local, intro: e.target.value })} className="mt-1 bg-white/5 border-white/10 rounded-xl" />
        </div>
        {local.strategies.map((s, i) => (
          <div key={i} className="rounded-lg bg-white/5 border border-white/10 p-3 space-y-2">
            <Input value={s.name} onChange={(e) => { const arr = [...local.strategies]; arr[i] = { ...arr[i], name: e.target.value }; setLocal({ ...local, strategies: arr }); }} className="bg-white/5 border-white/10 rounded-xl font-semibold" />
            <Input value={s.oneLiner} onChange={(e) => { const arr = [...local.strategies]; arr[i] = { ...arr[i], oneLiner: e.target.value }; setLocal({ ...local, strategies: arr }); }} className="bg-white/5 border-white/10 rounded-xl" />
            <Textarea value={s.body} onChange={(e) => { const arr = [...local.strategies]; arr[i] = { ...arr[i], body: e.target.value }; setLocal({ ...local, strategies: arr }); }} className="bg-white/5 border-white/10 rounded-xl" rows={3} />
          </div>
        ))}
        <div>
          <Label className="text-xs text-white/60">Non-negotiable Rules (one per line)</Label>
          <Textarea value={local.rules.join('\n')} onChange={(e) => setLocal({ ...local, rules: e.target.value.split('\n').filter(Boolean) })} className="mt-1 bg-white/5 border-white/10 rounded-xl" rows={5} />
        </div>
        <Button onClick={() => onSave(local)} disabled={saving} className="rounded-xl bg-sky-500 text-navy-950 hover:bg-sky-400"><Save className="w-4 h-4 mr-1" /> Save Strategy</Button>
      </CardContent>
    </Card>
  );
}

function TransparencyEditor({ content, onSave, saving }) {
  const [local, setLocal] = useState(null);
  useEffect(() => { if (content?.transparency) setLocal({ ...content.transparency }); }, [content]);
  if (!local) return null;
  const field = (key, label, placeholder = '') => (
    <div><Label className="text-xs text-white/60">{label}</Label>
      <Input value={local[key] || ''} onChange={(e) => setLocal({ ...local, [key]: e.target.value })} className="mt-1 bg-white/5 border-white/10 rounded-xl" placeholder={placeholder} />
    </div>
  );
  return (
    <Card className="glass border-white/10 rounded-2xl">
      <CardContent className="p-5 space-y-3">
        <div className="text-sm font-semibold text-white">Transparency & Contact</div>
        {field('forexFactoryUrl', 'ForexFactory URL')}
        {field('binanceId', 'Binance ID')}
        {field('email', 'Email')}
        {field('instagram', 'Instagram URL', '(optional)')}
        {field('tradingView', 'TradingView URL', '(optional)')}
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs text-white/60">Response hours</Label>
            <Input type="number" value={local.responseHours} onChange={(e) => setLocal({ ...local, responseHours: Number(e.target.value) })} className="mt-1 bg-white/5 border-white/10 rounded-xl" /></div>
          <div><Label className="text-xs text-white/60">Timezone</Label>
            <Input value={local.timezone} onChange={(e) => setLocal({ ...local, timezone: e.target.value })} className="mt-1 bg-white/5 border-white/10 rounded-xl" /></div>
        </div>
        <Button onClick={() => onSave(local)} disabled={saving} className="rounded-xl bg-sky-500 text-navy-950 hover:bg-sky-400"><Save className="w-4 h-4 mr-1" /> Save</Button>
      </CardContent>
    </Card>
  );
}

function FaqEditor({ content, onSave, saving }) {
  const [local, setLocal] = useState(null);
  useEffect(() => { if (content?.faq) setLocal(content.faq.map((x) => ({ ...x }))); }, [content]);
  if (!local) return null;
  return (
    <Card className="glass border-white/10 rounded-2xl">
      <CardContent className="p-5 space-y-3">
        <div className="text-sm font-semibold text-white">FAQ ({local.length} items)</div>
        {local.map((f, i) => (
          <div key={i} className="rounded-lg bg-white/5 border border-white/10 p-3 space-y-2">
            <Input value={f.q} onChange={(e) => { const arr = [...local]; arr[i] = { ...arr[i], q: e.target.value }; setLocal(arr); }} className="bg-white/5 border-white/10 rounded-xl font-semibold" />
            <Textarea value={f.a} onChange={(e) => { const arr = [...local]; arr[i] = { ...arr[i], a: e.target.value }; setLocal(arr); }} className="bg-white/5 border-white/10 rounded-xl" rows={2} />
          </div>
        ))}
        <Button onClick={() => onSave(local)} disabled={saving} className="rounded-xl bg-sky-500 text-navy-950 hover:bg-sky-400"><Save className="w-4 h-4 mr-1" /> Save FAQ</Button>
      </CardContent>
    </Card>
  );
}

function MailComposeButton({ contributor, onSend }) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const hasEmail = Boolean(contributor.email);

  const send = async () => {
    if (!message.trim()) return toast.error('Write a message first');
    setSending(true);
    try {
      await onSend(contributor.id, { subject: subject.trim(), message: message.trim() });
      setOpen(false);
      setSubject(''); setMessage('');
    } catch (e) { toast.error(e.message); }
    finally { setSending(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm" variant="outline" disabled={!hasEmail}
          title={hasEmail ? `Email ${contributor.email}` : 'No email on file'}
          className="rounded-lg border-sky-400/30 bg-sky-500/10 hover:bg-sky-500/20 text-sky-200 disabled:opacity-30"
        >
          <Mail className="w-3.5 h-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-navy-950 border-white/10 text-white rounded-2xl">
        <DialogHeader>
          <DialogTitle>Email {contributor.name || contributor.nickname || `#${contributor.displayId}`}</DialogTitle>
          <DialogDescription className="text-white/50">
            Sends from the official UNIBATCH address to <span className="text-sky-300">{contributor.email}</span>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-white/60">Subject</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. About your contribution" className="mt-1 bg-white/5 border-white/10 rounded-xl" />
          </div>
          <div>
            <Label className="text-xs text-white/60">Message</Label>
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={6} placeholder="Write your message…" className="mt-1 bg-white/5 border-white/10 rounded-xl" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={send} disabled={sending} className="rounded-xl bg-gradient-to-r from-sky-500 to-cyan-400 text-navy-950 font-semibold">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Send className="w-4 h-4 mr-1" /> Send email</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TxLinkRow({ contributorId, onLink }) {
  const [value, setValue] = useState('');
  return (
    <div className="mt-2 flex items-center gap-2">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Paste the real BscScan tx hash to verify & link (0x...)"
        className="h-8 bg-amber-500/5 border-amber-400/20 rounded-lg font-mono text-[11px]"
      />
      <Button
        size="sm"
        variant="outline"
        disabled={!value.trim()}
        onClick={() => { onLink(value.trim()); setValue(''); }}
        className="h-8 rounded-lg border-amber-400/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-200 shrink-0"
      >
        Link &amp; verify
      </Button>
    </div>
  );
}
