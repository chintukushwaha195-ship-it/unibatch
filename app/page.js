'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft, ChevronRight, Copy, Check, Wallet, ShieldCheck,
  ExternalLink, TrendingUp, Sparkles, Users, Target, ArrowRight,
  Loader2, BadgeCheck, Instagram, Mail, Rocket, BookOpen,
  Compass, Layers, Clock, ScrollText, ChevronDown, Star
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { toast } from 'sonner';

const WALLET_FALLBACK = '0x815c9aeE32b098f7256A51957E1A4eE7290DF314';
const trustLink = (addr) => `https://link.trustwallet.com/send?asset=c20000714_t0x55d398326f99059ff775485246999027b3197955&address=${addr}`;
const bscscanLink = (addr) => `https://bscscan.com/address/${addr}`;
const qrUrl = (addr) => `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(addr)}&bgcolor=0a1435&color=ffffff&margin=8&qzone=1`;

const PAGES = [
  { key: 'hero', label: 'Home' },
  { key: 'about', label: 'About' },
  { key: 'strategy', label: 'Strategy' },
  { key: 'support', label: 'Support' },
  { key: 'transparency', label: 'Transparency' },
  { key: 'faq', label: 'FAQ' },
];

// ---------- Animated background: candlesticks + grid ----------
function AnimatedBackground({ page }) {
  const seed = page;
  const candles = useMemo(() => {
    const arr = [];
    const rng = mulberry32(seed * 9973 + 1);
    for (let i = 0; i < 14; i++) {
      arr.push({
        left: rng() * 100,
        top: rng() * 100,
        h: 30 + rng() * 90,
        w: 6 + rng() * 4,
        delay: rng() * 4,
        dur: 6 + rng() * 6,
        up: rng() > 0.45,
      });
    }
    return arr;
  }, [seed]);
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden -z-10">
      <div className="absolute inset-0 grid-bg opacity-40" />
      <div className="absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-sky-500/20 blur-3xl" />
      <div className="absolute -bottom-40 -right-40 h-[500px] w-[500px] rounded-full bg-cyan-400/15 blur-3xl" />
      <div className="absolute top-1/3 left-1/2 h-[400px] w-[400px] -translate-x-1/2 rounded-full bg-gold-400/10 blur-3xl" />
      {candles.map((c, i) => (
        <motion.div
          key={i}
          className="absolute rounded-sm"
          style={{
            left: `${c.left}%`, top: `${c.top}%`,
            width: `${c.w}px`, height: `${c.h}px`,
            background: c.up ? 'linear-gradient(180deg, #22d3ee, #0ea5e9)' : 'linear-gradient(180deg, #f472b6, #ef4444)',
            boxShadow: c.up ? '0 0 20px rgba(34,211,238,0.5)' : '0 0 20px rgba(244,114,182,0.4)',
            opacity: 0.35,
          }}
          animate={{ y: [0, -30, 0], opacity: [0.15, 0.5, 0.15] }}
          transition={{ duration: c.dur, delay: c.delay, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}
    </div>
  );
}
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = a; t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ---------- SVG chart illustrations ----------
function Candle({ x, o, c, h, l, w = 8 }) {
  const up = c >= o;
  const bodyTop = Math.min(o, c);
  const bodyH = Math.max(2, Math.abs(c - o));
  const color = up ? '#22d3ee' : '#f472b6';
  return (
    <g>
      <line x1={x} y1={h} x2={x} y2={l} stroke={color} strokeWidth="1.2" />
      <rect x={x - w / 2} y={bodyTop} width={w} height={bodyH} fill={color} rx="1" />
    </g>
  );
}
function CompressionChart() {
  // squeeze that expands
  return (
    <svg viewBox="0 0 320 160" className="w-full">
      <defs>
        <linearGradient id="cg" x1="0" x2="1"><stop offset="0" stopColor="#38bdf8" stopOpacity="0.4"/><stop offset="1" stopColor="#38bdf8" stopOpacity="0"/></linearGradient>
      </defs>
      <rect x="60" y="55" width="140" height="45" fill="url(#cg)" stroke="#38bdf8" strokeDasharray="3 3" strokeOpacity="0.6" />
      {[15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, 195].map((x, i) => {
        const y = 78 + Math.sin(i) * (18 - i * 1.2);
        const o = y - 4, c = y + 4;
        const h = y - 8, l = y + 8;
        return <Candle key={i} x={x} o={o} c={c} h={h} l={l} />;
      })}
      {/* breakout */}
      <Candle x={215} o={78} c={40} h={35} l={80} />
      <Candle x={230} o={40} c={25} h={20} l={44} />
      <Candle x={245} o={25} c={15} h={10} l={30} />
      <text x="10" y="20" fill="#facc15" fontSize="10" fontFamily="monospace">Compression → Expansion</text>
    </svg>
  );
}
function TrendChart() {
  return (
    <svg viewBox="0 0 320 160" className="w-full">
      <path d="M 10 140 L 60 110 L 100 125 L 140 90 L 180 105 L 220 65 L 260 80 L 310 40" stroke="#22d3ee" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      {[[60,110],[140,90],[220,65]].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="4" fill="#facc15" />
      ))}
      {[[100,125],[180,105],[260,80]].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="3" fill="#38bdf8" fillOpacity="0.6" />
      ))}
      <text x="10" y="18" fill="#facc15" fontSize="10" fontFamily="monospace">Twice Trend · HH / HL confirmations</text>
    </svg>
  );
}
function LiquidityChart() {
  return (
    <svg viewBox="0 0 320 160" className="w-full">
      <line x1="10" y1="50" x2="310" y2="50" stroke="#f472b6" strokeDasharray="4 3" strokeOpacity="0.7" />
      <text x="15" y="46" fill="#f472b6" fontSize="9" fontFamily="monospace">Pre-session high</text>
      {[15, 30, 45, 60, 75, 90, 105, 120, 135].map((x, i) => {
        const y = 90 + Math.sin(i * 0.9) * 10;
        return <Candle key={i} x={x} o={y - 3} c={y + 3} h={y - 8} l={y + 8} />;
      })}
      {/* sweep */}
      <Candle x={165} o={70} c={40} h={30} l={72} />
      <Candle x={180} o={40} c={75} h={38} l={92} />
      <Candle x={195} o={75} c={95} h={72} l={100} />
      <Candle x={210} o={95} c={115} h={92} l={120} />
      <Candle x={225} o={115} c={130} h={112} l={135} />
      <text x="140" y="145" fill="#22d3ee" fontSize="9" fontFamily="monospace">Sweep → fade → target</text>
    </svg>
  );
}
const CHARTS = [CompressionChart, TrendChart, LiquidityChart];

// ---------- Navbar / Slider ----------
function Navbar({ page, setPage }) {
  return (
    <header className="fixed top-0 left-0 right-0 z-50">
      <div className="container mx-auto px-4 py-4 flex items-center justify-between">
        <button onClick={() => setPage(0)} className="flex items-center gap-2 group">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-400 to-gold-400 flex items-center justify-center font-bold text-navy-950 shadow-lg shadow-sky-500/30 group-hover:scale-105 transition">U</div>
          <div className="hidden sm:block text-left">
            <div className="font-bold tracking-tight text-white leading-none">UNIBATCH</div>
            <div className="text-[10px] text-sky-300/70 tracking-widest uppercase">Transparent Fund</div>
          </div>
        </button>
        <nav className="glass rounded-full px-1.5 py-1 flex items-center gap-1 overflow-x-auto max-w-[70vw] scrollbar-none">
          {PAGES.map((p, i) => (
            <button
              key={p.key}
              onClick={() => setPage(i)}
              className={`text-[11px] sm:text-xs px-2.5 sm:px-3 py-1.5 rounded-full transition-all whitespace-nowrap ${
                page === i ? 'bg-sky-500 text-navy-950 font-semibold shadow-md shadow-sky-500/30' : 'text-white/70 hover:text-white'
              }`}
            >
              {p.label}
            </button>
          ))}
        </nav>
        <Button size="sm" onClick={() => setPage(3)} className="hidden md:inline-flex bg-gradient-to-r from-sky-500 to-cyan-400 text-navy-950 hover:opacity-90 font-semibold rounded-full">Support Me</Button>
      </div>
    </header>
  );
}
function SliderControls({ page, setPage }) {
  return (
    <>
      <div className="fixed left-4 top-1/2 -translate-y-1/2 z-40 hidden md:block">
        <button disabled={page === 0} onClick={() => setPage(page - 1)} className="glass rounded-full w-11 h-11 flex items-center justify-center disabled:opacity-30 hover:bg-white/10 transition"><ChevronLeft className="w-5 h-5" /></button>
      </div>
      <div className="fixed right-4 top-1/2 -translate-y-1/2 z-40 hidden md:block">
        <button disabled={page === PAGES.length - 1} onClick={() => setPage(page + 1)} className="glass rounded-full w-11 h-11 flex items-center justify-center disabled:opacity-30 hover:bg-white/10 transition"><ChevronRight className="w-5 h-5" /></button>
      </div>
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 glass rounded-full px-4 py-2">
        {PAGES.map((p, i) => (
          <button key={p.key} onClick={() => setPage(i)} aria-label={p.label}
            className={`h-2 rounded-full transition-all ${i === page ? 'w-8 bg-sky-400' : 'w-2 bg-white/25 hover:bg-white/50'}`} />
        ))}
      </div>
    </>
  );
}

function StatCard({ icon: Icon, label, value, accent }) {
  return (
    <div className={`glass rounded-2xl p-4 ${accent === 'gold' ? 'glow-gold' : ''}`}>
      <div className="flex items-center gap-2 text-white/50 text-xs"><Icon className="w-3.5 h-3.5" />{label}</div>
      <div className={`mt-1 text-xl font-bold ${accent === 'gold' ? 'text-gold-400' : 'text-white'}`}>{value}</div>
    </div>
  );
}

// ---------- Pages ----------
function HeroPage({ setPage, stats }) {
  return (
    <section className="min-h-screen pt-24 pb-24 flex items-center">
      <div className="container mx-auto px-4">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="inline-flex items-center gap-2 rounded-full glass px-3 py-1 mb-5 text-xs">
              <BadgeCheck className="w-3.5 h-3.5 text-sky-300" />
              <span className="text-sky-100/90">Live-tracked on ForexFactory · Account #96</span>
            </motion.div>
            <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.05 }}
              className="font-display text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-[1.05] tracking-tight text-white">
              Fund a Trader&apos;s Dream —<br /><span className="text-gradient-brand">Just $250 to Start.</span>
            </motion.h1>
            <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.15 }}
              className="mt-6 text-lg text-white/70 max-w-xl leading-relaxed">
              I&apos;m <span className="text-white font-semibold">Chintu Kumar</span>, 17 — from Bihar, now in Haryana. Every dollar goes on-chain, every trade goes on ForexFactory. Fully transparent. Zero hidden moves.
            </motion.p>
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.25 }} className="mt-8 flex flex-wrap gap-3">
              <Button size="lg" onClick={() => setPage(3)} className="bg-gradient-to-r from-sky-500 to-cyan-400 text-navy-950 hover:opacity-90 font-semibold rounded-full shadow-lg shadow-sky-500/30 h-12 px-6">
                Support Me <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
              <Button size="lg" variant="outline" onClick={() => setPage(2)} className="rounded-full h-12 px-6 border-white/15 bg-white/5 hover:bg-white/10 text-white">
                <Layers className="w-4 h-4 mr-2" /> See Strategy
              </Button>
            </motion.div>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, delay: 0.35 }} className="mt-10 grid grid-cols-3 gap-3 max-w-lg">
              <StatCard icon={Target} label="Goal" value={`$${stats?.goal ?? 250}`} />
              <StatCard icon={TrendingUp} label="Raised" value={`$${stats?.raised ?? '—'}`} accent="gold" />
              <StatCard icon={Users} label="Backers" value={stats?.count ?? '—'} />
            </motion.div>
          </div>
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.7, delay: 0.15 }} className="relative">
            <div className="absolute -inset-8 bg-gradient-to-br from-sky-500/30 via-cyan-400/20 to-gold-400/20 blur-3xl rounded-full" />
            <Card className="relative glass border-white/10 rounded-3xl overflow-hidden">
              <CardContent className="p-8">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <div className="text-xs uppercase tracking-widest text-white/50">Live Progress</div>
                    <div className="mt-1 text-3xl font-bold text-white">${stats?.raised ?? 0}<span className="text-white/40 text-lg font-medium"> / ${stats?.goal ?? 250}</span></div>
                  </div>
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-sky-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-sky-500/40 animate-glow"><Wallet className="w-7 h-7 text-navy-950" /></div>
                </div>
                <Progress value={stats?.progress || 0} className="h-3 bg-white/5" />
                <div className="mt-2 flex items-center justify-between text-xs text-white/50">
                  <span>{(stats?.progress || 0).toFixed(1)}% funded</span>
                  <span>${stats?.remaining ?? 250} to goal</span>
                </div>
                <div className="mt-6 grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-xl bg-white/5 p-3"><div className="text-white/50">Network</div><div className="text-white font-semibold mt-0.5">USDT · BEP20</div></div>
                  <div className="rounded-xl bg-white/5 p-3"><div className="text-white/50">Contributors</div><div className="text-white font-semibold mt-0.5">{stats?.count ?? 0}</div></div>
                </div>
                <div className="mt-5 rounded-xl bg-gradient-to-r from-sky-500/10 to-gold-400/10 border border-sky-400/20 p-3 flex items-center gap-2 text-xs text-sky-100/90">
                  <Sparkles className="w-4 h-4 text-gold-400" />Every contribution logs an on-chain trail. Fully transparent.
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function AboutPage({ content }) {
  const about = content?.about;
  if (!about) return <SectionLoader />;
  const intro = about.intro || {};
  return (
    <section className="min-h-screen pt-24 pb-24">
      <div className="container mx-auto px-4 max-w-4xl">
        <div className="text-center mb-10">
          <Badge className="bg-sky-500/15 text-sky-300 border-sky-400/20 rounded-full px-3 py-1">About Me</Badge>
          <h2 className="mt-4 text-3xl sm:text-4xl font-extrabold text-white">{intro.fullName || 'Chintu Kumar'} · {intro.age ?? 17}</h2>
          <p className="mt-3 text-white/60 max-w-2xl mx-auto">{intro.location}</p>
        </div>

        {/* Intro card */}
        <Card className="glass border-white/10 rounded-3xl glow-cyan mb-6">
          <CardContent className="p-6 sm:p-8">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="rounded-xl bg-white/5 border border-white/10 p-4">
                <div className="text-[10px] uppercase tracking-widest text-white/50">Experience</div>
                <div className="mt-1 text-white font-semibold">{intro.experience}</div>
              </div>
              <div className="rounded-xl bg-white/5 border border-white/10 p-4">
                <div className="text-[10px] uppercase tracking-widest text-white/50">Markets I trade</div>
                <div className="mt-1 text-white/90 text-sm leading-relaxed">{intro.markets}</div>
              </div>
            </div>
            <div className="mt-4 rounded-xl bg-gradient-to-r from-sky-500/10 to-gold-400/10 border border-sky-400/20 p-4">
              <div className="text-[10px] uppercase tracking-widest text-sky-300">Milestone</div>
              <p className="mt-1 text-white/90 leading-relaxed">{intro.milestones}</p>
            </div>
            <div className="mt-4 rounded-xl bg-gradient-to-r from-gold-400/10 to-sky-500/10 border border-gold-400/20 p-4">
              <div className="text-[10px] uppercase tracking-widest text-gold-400">Personal motivation</div>
              <p className="mt-1 text-white/90 leading-relaxed">{intro.motivation}</p>
            </div>
          </CardContent>
        </Card>

        <div className="text-center my-8">
          <Badge className="bg-cyan-500/15 text-cyan-300 border-cyan-400/30 rounded-full px-3 py-1">My Trading Journey</Badge>
        </div>

        <div className="space-y-4">
          {about.chapters.map((ch, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.4, delay: i * 0.05 }}>
              <Card className="glass border-white/10 rounded-2xl">
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <div className="w-11 h-11 shrink-0 rounded-xl bg-gradient-to-br from-sky-500/30 to-gold-400/20 border border-white/10 flex items-center justify-center text-sky-200 font-bold uppercase">{ch.letter || String.fromCharCode(97 + i)}</div>
                    <div className="min-w-0">
                      <div className="font-semibold text-white text-lg">{ch.title}</div>
                      <div className="mt-2 text-white/75 leading-relaxed space-y-3">
                        {ch.body.split('\n\n').map((para, j) => <p key={j}>{para}</p>)}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function StrategyPage({ content }) {
  const st = content?.strategy;
  if (!st) return <SectionLoader />;
  const paras = (s) => (s || '').split('\n\n').map((p, i) => <p key={i}>{p}</p>);

  return (
    <section className="min-h-screen pt-24 pb-24">
      <div className="container mx-auto px-4 max-w-5xl">
        <div className="text-center mb-8">
          <Badge className="bg-cyan-500/15 text-cyan-300 border-cyan-400/30 rounded-full px-3 py-1">My Strategy</Badge>
          <h2 className="mt-4 text-3xl sm:text-4xl font-extrabold text-white">Three setups · Five rules · One journal</h2>
        </div>

        {/* Q1 - Approach */}
        <Card className="glass border-white/10 rounded-2xl mb-4">
          <CardContent className="p-6">
            <div className="text-xs uppercase tracking-widest text-sky-300 font-semibold mb-2">Trading approach &amp; style</div>
            <div className="text-white/80 leading-relaxed space-y-3">{paras(st.approach)}</div>
          </CardContent>
        </Card>

        {/* Q2 - Markets */}
        <Card className="glass border-white/10 rounded-2xl mb-8">
          <CardContent className="p-6">
            <div className="text-xs uppercase tracking-widest text-cyan-300 font-semibold mb-2">Markets &amp; sessions</div>
            <div className="text-white/80 leading-relaxed space-y-3">{paras(st.markets)}</div>
          </CardContent>
        </Card>

        {/* Strategies tabs */}
        <div className="text-center mb-4">
          <Badge className="bg-gold-400/15 text-gold-400 border-gold-400/30 rounded-full px-3 py-1">UNIBATCH Trading Handbook</Badge>
        </div>
        <Tabs defaultValue="0" className="w-full">
          <TabsList className="glass rounded-full h-auto p-1 mx-auto flex flex-wrap justify-center">
            {st.strategies.map((s, i) => (
              <TabsTrigger key={i} value={String(i)} className="rounded-full data-[state=active]:bg-sky-500 data-[state=active]:text-navy-950 data-[state=active]:font-semibold text-white/70 px-4 py-1.5 text-sm">
                {s.volume ? `${s.volume} · ` : ''}{s.name}
              </TabsTrigger>
            ))}
          </TabsList>
          {st.strategies.map((s, i) => (
            <TabsContent key={i} value={String(i)} className="mt-6">
              <Card className="glass border-white/10 rounded-3xl overflow-hidden">
                <CardContent className="p-6 sm:p-8">
                  <div className="text-xs uppercase tracking-widest text-sky-300 font-semibold">{s.volume || `Volume ${i + 1}`}</div>
                  <div className="mt-1 text-2xl sm:text-3xl font-extrabold text-white">{s.name}</div>
                  {s.caption && <p className="mt-2 text-gold-400 italic text-sm">Caption: {s.caption}</p>}

                  <div className="mt-6 grid lg:grid-cols-2 gap-6">
                    {/* Left: text sections */}
                    <div className="space-y-4">
                      {(s.sections || []).map((sec, j) => (
                        <div key={j} className="rounded-xl bg-white/5 border border-white/10 p-4">
                          <div className="text-sky-300 text-xs uppercase tracking-widest font-semibold">{sec.heading}</div>
                          <p className="mt-1.5 text-white/80 leading-relaxed text-sm">{sec.body}</p>
                        </div>
                      ))}
                      {/* legacy body/oneLiner support if present */}
                      {(!s.sections || s.sections.length === 0) && s.body && (
                        <div className="rounded-xl bg-white/5 border border-white/10 p-4 text-white/80 text-sm">{s.body}</div>
                      )}
                    </div>

                    {/* Right: PDF page images (verbatim) */}
                    <div className="space-y-4">
                      {(s.images || []).map((img, j) => (
                        <div key={j} className="rounded-xl bg-navy-900 p-2 border border-white/10">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={img} alt={`${s.name} page ${j + 1}`} className="w-full rounded-lg" />
                          <div className="text-[10px] uppercase tracking-widest text-white/40 text-center mt-2">
                            {s.name} · Page {j + 1}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>

        {/* Risk stats */}
        <div className="mt-10 grid grid-cols-2 md:grid-cols-4 gap-3">
          {(st.riskStats || []).map((r, i) => (
            <Card key={i} className="glass border-white/10 rounded-2xl">
              <CardContent className="p-4">
                <div className="text-xs uppercase tracking-widest text-white/50">{r.label}</div>
                <div className="mt-1 text-2xl font-bold text-gradient-brand">{r.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Q3 - Risk Management full */}
        {st.riskFull && (
          <Card className="glass border-white/10 rounded-2xl mt-8 glow-cyan">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 text-sky-300 mb-3"><ShieldCheck className="w-4 h-4" /><div className="text-xs uppercase tracking-widest font-semibold">Risk Management</div></div>
              <div className="text-white/80 leading-relaxed space-y-3 text-sm">{paras(st.riskFull)}</div>
            </CardContent>
          </Card>
        )}

        {/* Q4 - Daily Routine */}
        {st.routineFull && (
          <Card className="glass border-white/10 rounded-2xl mt-4">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 text-cyan-300 mb-3"><Clock className="w-4 h-4" /><div className="text-xs uppercase tracking-widest font-semibold">Daily Routine (IST)</div></div>
              <div className="text-white/80 leading-relaxed space-y-3 text-sm">{paras(st.routineFull)}</div>
            </CardContent>
          </Card>
        )}

        {/* Q5 - Tools */}
        {st.toolsFull && (
          <Card className="glass border-white/10 rounded-2xl mt-4">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 text-gold-400 mb-3"><Layers className="w-4 h-4" /><div className="text-xs uppercase tracking-widest font-semibold">Tools &amp; Platforms</div></div>
              <div className="text-white/80 leading-relaxed space-y-3 text-sm">{paras(st.toolsFull)}</div>
              {Array.isArray(st.tools) && st.tools.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {st.tools.map((t, i) => <Badge key={i} className="bg-white/5 border-white/10 text-white/80">{t}</Badge>)}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Q6 - 5 Rules */}
        <Card className="glass border-white/10 rounded-2xl mt-4 glow-gold">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 text-gold-400 mb-3"><ScrollText className="w-4 h-4" /><div className="text-xs uppercase tracking-widest font-semibold">Non-Negotiable Rules</div></div>
            <ol className="space-y-2">
              {(st.rules || []).map((r, i) => (
                <li key={i} className="flex gap-3 text-sm text-white/85">
                  <span className="text-gold-400 font-bold shrink-0 tabular-nums">{i + 1}.</span>{r}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        {/* Q7 - Differentiator */}
        {st.differentiator && (
          <Card className="glass border-white/10 rounded-2xl mt-4">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 text-sky-300 mb-3"><Rocket className="w-4 h-4" /><div className="text-xs uppercase tracking-widest font-semibold">What sets me apart</div></div>
              <div className="text-white/80 leading-relaxed space-y-3 text-sm">{paras(st.differentiator)}</div>
            </CardContent>
          </Card>
        )}

        {/* Q8 - $250 Usage */}
        {st.usage && (
          <Card className="glass border-white/10 rounded-2xl mt-4">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 text-white mb-3"><Wallet className="w-4 h-4 text-gold-400" /><div className="text-xs uppercase tracking-widest font-semibold text-white/60">How I will use the $250</div></div>
              <div className="text-white/80 leading-relaxed space-y-3 text-sm">{paras(st.usage)}</div>
            </CardContent>
          </Card>
        )}
      </div>
    </section>
  );
}

function SupportPage({ stats, contributors, refresh, content }) {
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ name: '', amount: '', txHash: '' });
  const wallet = content?.primaryWallet || stats?.wallet || WALLET_FALLBACK;
  const extraWallets = content?.wallets || [];

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(wallet);
      setCopied(true); toast.success('Wallet address copied');
      setTimeout(() => setCopied(false), 2000);
    } catch { toast.error('Copy failed'); }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error('Please enter a name or nickname');
    const amt = parseFloat(form.amount);
    if (!(amt > 0)) return toast.error('Please enter an amount greater than 0');
    setSubmitting(true);
    try {
      const res = await fetch('/api/contributors', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name, nickname: form.name, amount: amt, txHash: form.txHash }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      toast.success(`Thank you! You are contributor ${data.contributor.displayId}`);
      setForm({ name: '', amount: '', txHash: '' });
      refresh();
    } catch (err) { toast.error(err.message); }
    finally { setSubmitting(false); }
  };

  return (
    <section className="min-h-screen pt-24 pb-24">
      <div className="container mx-auto px-4">
        <div className="text-center mb-10">
          <Badge className="bg-sky-500/15 text-sky-300 border-sky-400/20 rounded-full px-3 py-1">USDT · BEP20 · Binance Smart Chain</Badge>
          <h2 className="mt-4 text-3xl sm:text-4xl font-extrabold text-white">Send Your Support</h2>
          <p className="mt-2 text-white/60 max-w-lg mx-auto">Scan the QR or copy the address below. Every transaction is publicly verifiable on-chain.</p>
        </div>

        <div className="max-w-3xl mx-auto mb-10">
          <Card className="glass border-white/10 rounded-3xl">
            <CardContent className="p-6">
              <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
                <div>
                  <div className="text-xs uppercase tracking-widest text-white/50">Raised so far</div>
                  <div className="mt-1 text-3xl font-bold"><span className="text-gradient-brand">${stats?.raised ?? 0}</span><span className="text-white/40 text-lg"> / ${stats?.goal ?? 250}</span></div>
                </div>
                <div className="text-right"><div className="text-xs uppercase tracking-widest text-white/50">Contributors</div><div className="text-2xl font-bold text-white">{stats?.count ?? 0}</div></div>
              </div>
              <Progress value={stats?.progress || 0} className="h-3 bg-white/5" />
              <div className="mt-2 flex justify-between text-xs text-white/50"><span>{(stats?.progress || 0).toFixed(1)}% funded</span><span>${stats?.remaining ?? 250} remaining</span></div>
            </CardContent>
          </Card>
        </div>

        <div className="grid lg:grid-cols-5 gap-6 max-w-6xl mx-auto">
          <Card className="lg:col-span-3 glass border-white/10 rounded-3xl overflow-hidden glow-cyan">
            <CardContent className="p-6 sm:p-8">
              <div className="flex items-center justify-between mb-6">
                <div><div className="text-xs uppercase tracking-widest text-white/50">USDT · BEP20</div><div className="mt-1 font-bold text-lg text-white">Trading Fund Wallet</div></div>
                <Badge className="bg-gold-400/15 text-gold-400 border-gold-400/30">Verified</Badge>
              </div>
              <div className="grid sm:grid-cols-[240px,1fr] gap-6 items-start">
                <div className="mx-auto rounded-2xl bg-navy-900 p-3 ring-1 ring-white/10">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrUrl(wallet)} alt="Wallet QR" className="rounded-lg w-[220px] h-[220px]" />
                  <div className="mt-2 text-center text-[10px] uppercase tracking-widest text-white/50">Scan with Trust Wallet</div>
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-widest text-white/50">Address</Label>
                  <div className="mt-2 flex items-stretch gap-2">
                    <div className="flex-1 rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 font-mono text-[11px] sm:text-xs break-all text-white/90">{wallet}</div>
                    <Button onClick={copyAddress} className="rounded-xl bg-sky-500 text-navy-950 hover:bg-sky-400 font-semibold px-4">{copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}</Button>
                  </div>
                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <a href={trustLink(wallet)} target="_blank" rel="noreferrer">
                      <Button variant="outline" className="w-full rounded-xl border-white/15 bg-white/5 hover:bg-white/10 text-white justify-start"><Wallet className="w-4 h-4 mr-2 text-sky-300" /> Send via Trust Wallet</Button>
                    </a>
                    <a href={bscscanLink(wallet)} target="_blank" rel="noreferrer">
                      <Button variant="outline" className="w-full rounded-xl border-white/15 bg-white/5 hover:bg-white/10 text-white justify-start"><ExternalLink className="w-4 h-4 mr-2 text-cyan-300" /> View on BscScan</Button>
                    </a>
                  </div>
                  <div className="mt-4 rounded-xl bg-rose-500/10 border border-rose-400/20 p-3 text-[11px] text-rose-100 flex gap-2">
                    <ShieldCheck className="w-4 h-4 shrink-0 text-rose-300 mt-0.5" />
                    <div><b>Safety:</b> Only send <b>USDT on BEP20 (BSC)</b>. Other tokens or networks may result in permanent loss.</div>
                  </div>
                  {extraWallets.length > 0 && (
                    <div className="mt-4 space-y-1">
                      <div className="text-[10px] uppercase tracking-widest text-white/40">Additional networks</div>
                      {extraWallets.map((w) => (
                        <div key={w.id} className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-[11px] font-mono flex items-center justify-between gap-2">
                          <div className="min-w-0"><b className="text-sky-300">{w.label || w.network}</b> <span className="text-white/60 break-all">{w.address}</span></div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2 glass border-white/10 rounded-3xl">
            <CardContent className="p-6 sm:p-8">
              <div className="mb-5">
                <div className="text-xs uppercase tracking-widest text-white/50">After you send</div>
                <div className="mt-1 font-bold text-lg text-white">Leave your mark</div>
                <p className="text-white/60 text-sm mt-1">Add your name and TX hash — we&apos;ll list you on the wall once verified.</p>
              </div>
              <form onSubmit={submit} className="space-y-3">
                <div><Label htmlFor="name" className="text-xs text-white/60">Name or Nickname</Label>
                  <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Alex or CryptoDegen" className="mt-1 bg-white/5 border-white/10 rounded-xl" /></div>
                <div><Label htmlFor="amount" className="text-xs text-white/60">Amount (USDT)</Label>
                  <Input id="amount" type="number" step="0.01" min="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="10" className="mt-1 bg-white/5 border-white/10 rounded-xl" /></div>
                <div><Label htmlFor="tx" className="text-xs text-white/60">TX Hash (optional but recommended)</Label>
                  <Input id="tx" value={form.txHash} onChange={(e) => setForm({ ...form, txHash: e.target.value })} placeholder="0x…" className="mt-1 bg-white/5 border-white/10 rounded-xl font-mono text-xs" /></div>
                <Button type="submit" disabled={submitting} className="w-full rounded-xl bg-gradient-to-r from-sky-500 to-cyan-400 text-navy-950 font-semibold hover:opacity-90 h-11">
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Add me to the wall'}
                </Button>
                <p className="text-[10px] text-white/40 text-center leading-relaxed">If you submit a TX hash matching an on-chain transfer, your name is attached automatically.</p>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* Contributor Wall */}
        <div className="max-w-4xl mx-auto mt-14">
          <div className="text-center mb-6">
            <Badge className="bg-gold-400/15 text-gold-400 border-gold-400/30 rounded-full px-3 py-1">Public Contributor Wall</Badge>
            <h3 className="mt-3 text-2xl sm:text-3xl font-extrabold text-white">The people making it happen</h3>
            <p className="mt-1 text-white/60 text-sm">Names appear only after contributors opt in.</p>
          </div>
          {contributors?.length === 0 ? (
            <Card className="glass border-white/10 rounded-3xl">
              <CardContent className="p-12 text-center">
                <Sparkles className="w-10 h-10 text-sky-400 mx-auto mb-3" />
                <div className="text-white font-semibold">Be the first contributor.</div>
                <div className="text-white/60 text-sm mt-1">Your name at #000001 forever.</div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {contributors.map((c) => (
                <motion.div key={c.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
                  <Card className={`glass border-white/10 rounded-2xl hover:border-sky-400/30 transition ${c.highlighted ? 'ring-1 ring-gold-400/40' : ''}`}>
                    <CardContent className="p-4 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-11 h-11 shrink-0 rounded-xl bg-gradient-to-br from-sky-500/30 to-gold-400/20 flex items-center justify-center font-mono text-xs text-sky-200 border border-white/10">{c.displayId}</div>
                        <div className="min-w-0">
                          <div className="text-white font-semibold truncate flex items-center gap-1.5">
                            {c.highlighted && <Star className="w-3.5 h-3.5 text-gold-400 fill-gold-400" />}
                            {c.approved && (c.name || c.nickname) ? (c.name || c.nickname) : <span className="text-white/50">Anonymous</span>}
                          </div>
                          <div className="text-[11px] text-white/50 flex items-center gap-2 flex-wrap">
                            <span>{new Date(c.createdAt).toUTCString().slice(5, 22)}</span>
                            <span className="text-white/25">·</span>
                            <span className="text-sky-300/80">{c.session} UTC</span>
                            {c.txHash && (<><span className="text-white/25">·</span><a href={`https://bscscan.com/tx/${c.txHash}`} target="_blank" rel="noreferrer" className="text-cyan-300 hover:underline inline-flex items-center gap-1">tx <ExternalLink className="w-3 h-3" /></a></>)}
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-gold-400 font-bold">${Number(c.amount).toFixed(2)}</div>
                        <div className="text-[10px] uppercase tracking-widest text-white/40">USDT</div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function TransparencyPage({ content }) {
  const t = content?.transparency;
  if (!t) return <SectionLoader />;
  return (
    <section className="min-h-screen pt-24 pb-24">
      <div className="container mx-auto px-4 max-w-4xl">
        <div className="text-center mb-10">
          <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-400/30 rounded-full px-3 py-1">Transparency + Contact</Badge>
          <h2 className="mt-4 text-3xl sm:text-4xl font-extrabold text-white">Verify everything. Reach me anytime.</h2>
          <p className="mt-2 text-white/60 max-w-2xl mx-auto">Every trade, every dollar, every message logged in public. Reply within {t.responseHours} hours ({t.timezone}).</p>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <a href={t.forexFactoryUrl} target="_blank" rel="noreferrer" className="block">
            <Card className="glass border-white/10 rounded-2xl hover:border-cyan-400/40 transition h-full">
              <CardContent className="p-6">
                <div className="flex items-center gap-2 text-cyan-300 text-xs uppercase tracking-widest"><BookOpen className="w-4 h-4" /> ForexFactory · Trade Explorer</div>
                <div className="mt-2 text-white text-lg font-bold">Account #96 — &quot;UNIBATCH $250&quot;</div>
                <div className="text-white/60 text-sm mt-1">Antiseptic (audited) trade log. Every position, entry, and exit is publicly visible.</div>
                <div className="mt-3 text-cyan-300 text-xs inline-flex items-center gap-1">Open in new tab <ExternalLink className="w-3 h-3" /></div>
              </CardContent>
            </Card>
          </a>

          <Card className="glass border-white/10 rounded-2xl">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 text-gold-400 text-xs uppercase tracking-widest"><Wallet className="w-4 h-4" /> Binance</div>
              <div className="mt-2 text-white text-lg font-bold">ID {t.binanceId}</div>
              <div className="text-white/60 text-sm mt-1">Reference ID for CEX-based transfers or verification purposes.</div>
            </CardContent>
          </Card>

          <a href={`mailto:${t.email}`} className="block md:col-span-2">
            <Card className="glass border-white/10 rounded-2xl hover:border-sky-400/40 transition glow-cyan">
              <CardContent className="p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4 justify-between">
                <div>
                  <div className="flex items-center gap-2 text-sky-300 text-xs uppercase tracking-widest"><Mail className="w-4 h-4" /> Primary Channel</div>
                  <div className="mt-2 text-white text-lg font-bold">{t.email}</div>
                  <div className="text-white/60 text-sm mt-1">Discord invites are shared over email on request. Reply promise: {t.responseHours}h · {t.timezone}.</div>
                </div>
                <Button className="rounded-full bg-gradient-to-r from-sky-500 to-cyan-400 text-navy-950 font-semibold"><Mail className="w-4 h-4 mr-2" /> Email Chintu</Button>
              </CardContent>
            </Card>
          </a>

          {t.instagram && (
            <a href={t.instagram} target="_blank" rel="noreferrer" className="block">
              <Card className="glass border-white/10 rounded-2xl hover:border-pink-400/40 transition h-full">
                <CardContent className="p-6">
                  <div className="flex items-center gap-2 text-pink-300 text-xs uppercase tracking-widest"><Instagram className="w-4 h-4" /> Instagram</div>
                  <div className="mt-2 text-white text-lg font-bold break-all">{t.instagram}</div>
                </CardContent>
              </Card>
            </a>
          )}
          {t.tradingView && (
            <a href={t.tradingView} target="_blank" rel="noreferrer" className="block">
              <Card className="glass border-white/10 rounded-2xl hover:border-sky-400/40 transition h-full">
                <CardContent className="p-6">
                  <div className="flex items-center gap-2 text-sky-300 text-xs uppercase tracking-widest"><TrendingUp className="w-4 h-4" /> TradingView</div>
                  <div className="mt-2 text-white text-lg font-bold break-all">{t.tradingView}</div>
                </CardContent>
              </Card>
            </a>
          )}
        </div>
      </div>
    </section>
  );
}

function FaqPage({ content }) {
  const faq = content?.faq || [];
  if (faq.length === 0) return <SectionLoader />;
  // interleave PDF page images every 4 questions
  const chunks = [];
  const chartImages = ['/strategy/compression-1.png', '/strategy/twicetrend-1.png', '/strategy/firsttaker-1.png'];
  const chartLabels = ['Volume 1 · Compression', 'Volume 2 · Twice Trend Setup', 'Volume 3 · First Taker'];
  for (let i = 0; i < faq.length; i += 4) chunks.push(faq.slice(i, i + 4));

  return (
    <section className="min-h-screen pt-24 pb-24">
      <div className="container mx-auto px-4 max-w-3xl">
        <div className="text-center mb-10">
          <Badge className="bg-cyan-500/15 text-cyan-300 border-cyan-400/30 rounded-full px-3 py-1">Frequently Asked</Badge>
          <h2 className="mt-4 text-3xl sm:text-4xl font-extrabold text-white">Everything you might want to ask</h2>
        </div>

        {chunks.map((chunk, ci) => {
          const img = chartImages[ci % chartImages.length];
          const label = chartLabels[ci % chartLabels.length];
          return (
            <div key={ci} className="mb-6">
              <Accordion type="single" collapsible className="space-y-2">
                {chunk.map((f, i) => (
                  <AccordionItem key={ci * 4 + i} value={`i-${ci}-${i}`} className="glass border-white/10 rounded-2xl px-4 border">
                    <AccordionTrigger className="text-left text-white hover:no-underline hover:text-sky-200">
                      <span className="text-sky-300 font-mono text-xs mr-3">Q{String(ci * 4 + i + 1).padStart(2, '0')}</span>{f.q}
                    </AccordionTrigger>
                    <AccordionContent className="text-white/70">{f.a}</AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
              {ci < chunks.length - 1 && (
                <Card className="glass border-white/10 rounded-2xl mt-4">
                  <CardContent className="p-4">
                    <div className="rounded-xl bg-navy-900 p-2 border border-white/10">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img} alt={label} className="w-full rounded-lg" />
                    </div>
                    <div className="text-[10px] uppercase tracking-widest text-white/40 text-center mt-2">{label} · from the UNIBATCH Handbook</div>
                  </CardContent>
                </Card>
              )}
            </div>
          );
        })}

        <Card className="glass border-white/10 rounded-2xl mt-8">
          <CardContent className="p-5 text-xs text-white/50 leading-relaxed">
            All strategies, examples, and educational materials on this website are provided strictly for educational and informational purposes. This is not financial advice. Trading is risky — only trade with capital you can afford to lose. See the full <Link href="/legal" className="text-sky-300 underline">Legal Disclaimer</Link>.
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function SectionLoader() {
  return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-sky-400" /></div>;
}

function Footer({ setPage }) {
  return (
    <footer className="border-t border-white/10 mt-8">
      <div className="container mx-auto px-4 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs">
        <div className="text-white/40">© 2026 Chintu Kushwaha · UNIBATCH — Transparent Trading Fund</div>
        <div className="flex items-center gap-4">
          <button onClick={() => setPage(5)} className="text-white/50 hover:text-white">FAQ</button>
          <Link href="/legal" className="text-white/50 hover:text-white">Legal Disclaimer</Link>
          <Link href="/admin-login" className="text-white/40 hover:text-sky-300">Admin</Link>
        </div>
      </div>
    </footer>
  );
}

// ---------- Root App ----------
function App() {
  const [page, setPage] = useState(0);
  const [stats, setStats] = useState(null);
  const [contributors, setContributors] = useState([]);
  const [content, setContent] = useState(null);

  const load = async () => {
    try {
      const [s, c, ct] = await Promise.all([
        fetch('/api/stats').then((r) => r.json()),
        fetch('/api/contributors').then((r) => r.json()),
        fetch('/api/content').then((r) => r.json()),
      ]);
      setStats(s);
      setContributors(c.contributors || []);
      setContent(ct);
    } catch (e) { console.error(e); }
  };

  useEffect(() => {
  const tick = async () => {
    try {
      await fetch("/api/sync", {
        method: "POST",
      });

      await load();
    } catch (e) {
      console.error(e);
    }
  };

  tick();

  const t = setInterval(tick, 15000);

  return () => clearInterval(t);
}, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if (e.key === 'ArrowRight' && page < PAGES.length - 1) setPage((p) => p + 1);
      if (e.key === 'ArrowLeft' && page > 0) setPage((p) => p - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [page]);

  return (
    <div className="relative min-h-screen text-white overflow-x-hidden">
      <AnimatedBackground page={page} />
      <Navbar page={page} setPage={setPage} />
      <SliderControls page={page} setPage={setPage} />

      <AnimatePresence mode="wait">
        <motion.div key={page} initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} transition={{ duration: 0.35, ease: 'easeOut' }}>
          {page === 0 && <HeroPage setPage={setPage} stats={stats} />}
          {page === 1 && <AboutPage content={content} />}
          {page === 2 && <StrategyPage content={content} />}
          {page === 3 && <SupportPage stats={stats} contributors={contributors} refresh={load} content={content} />}
          {page === 4 && <TransparencyPage content={content} />}
          {page === 5 && <FaqPage content={content} />}
        </motion.div>
      </AnimatePresence>

      <Footer setPage={setPage} />
    </div>
  );
}

export default App;
