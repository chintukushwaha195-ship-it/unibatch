'use client';

import Link from 'next/link';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

const SECTIONS = [
  {
    title: 'Personal Project Notice',
    body: `This website is an independent personal project created to document my trading journey, maintain complete transparency, and responsibly raise a small amount of trading capital.

The purpose of this website is to share my progress, trading discipline, educational experiences, and long-term vision of building a transparent community for serious traders.

This website is **not** operated by any financial institution, investment company, brokerage, or proprietary trading firm.`,
  },
  {
    title: 'Financial Disclaimer',
    body: `The information shared on this website is intended for educational, informational, and transparency purposes only.

Nothing published on this website should be interpreted as:
- Financial advice
- Investment advice
- Trading signals
- Portfolio management
- Legal advice
- Tax advice

Every visitor is solely responsible for their own financial decisions. Trading leveraged financial products involves substantial risk and may result in the complete loss of capital. Past performance never guarantees future results.`,
  },
  {
    title: 'Donation Policy',
    body: `All contributions made through this website are completely voluntary personal donations. Every donation is used exclusively to support my trading journey, website development, transparency tools, and future community initiatives.

Contributors do **not** receive:
- Ownership
- Equity
- Company shares
- Profit sharing
- Investment contracts
- Financial returns
- Guaranteed income
- Any legal claim over future profits

This fundraiser should never be considered an investment opportunity.`,
  },
  {
    title: 'Cryptocurrency Notice',
    body: `Cryptocurrency transactions are irreversible. Before sending any contribution, always verify:
- Wallet address
- Blockchain network
- Amount

Transactions sent to the wrong blockchain network may be permanently lost. QR Codes are provided for convenience and to reduce copy/paste mistakes.`,
  },
  {
    title: 'Refund Policy',
    body: `Because cryptocurrency transactions are permanently recorded on the blockchain, donations are generally **non-refundable** once confirmed.

If a duplicate payment or technical issue occurs, contributors may contact me via email for review. Any refund decision remains at my sole discretion.`,
  },
  {
    title: 'Transparency Commitment',
    body: `I believe trust should be earned through transparency — not promises. To support this principle, I publicly provide:
- Forex Factory Trade Explorer
- Public blockchain wallet addresses
- Donation progress
- Trading updates
- Performance records

Visitors are encouraged to verify my progress independently.`,
  },
  {
    title: 'Future Community Vision',
    body: `Even if this fundraising campaign does not reach its target, this website will remain active.

My long-term vision is to develop this platform into a transparent community where verified traders can present:
- Identity verification
- Trading strategy
- Trading journal
- Verified performance
- Responsible risk management

Future contributors may voluntarily choose to support those traders. The purpose of this platform is **not** to raise large amounts of money, but to create opportunities for serious individuals who lack access to trading capital.

Special consideration may eventually be given to responsible traders facing genuine financial barriers, including women with limited financial opportunities, people with physical disabilities, and other deserving individuals who demonstrate discipline and transparency.`,
  },
  {
    title: 'Intellectual Property',
    body: `Unless otherwise stated, all original content on this website — including but not limited to articles, trading journals, graphics, website design, logos, icons, written content, custom tools, and source code created by me — is protected under applicable copyright laws.

No content may be copied, reproduced, modified, redistributed, or republished without prior written permission.`,
  },
  {
    title: 'Third-Party Trademarks',
    body: `All trademarks, logos, product names, company names, and registered trademarks mentioned on this website remain the property of their respective owners.

This includes, but is not limited to: Forex Factory, MetaTrader, TradingView, Trust Wallet, Binance, RoboForex, Upwork, Internshala.

Their appearance on this website is for identification, educational, or transparency purposes only and does not imply endorsement, sponsorship, partnership, or affiliation.`,
  },
  {
    title: 'Privacy Notice',
    body: `I respect your privacy. Only information voluntarily provided by visitors (such as email addresses or names) will be used for communication purposes. I do not sell, rent, trade, or distribute personal information to third parties.

Public blockchain transactions remain publicly visible by design.`,
  },
  {
    title: 'Contact',
    body: `For questions regarding this website, transparency, donations, or trading:

Email: **chintukumar911@gmail.com**
Timezone: **India Standard Time (IST · UTC +5:30)**`,
  },
  {
    title: 'Independent Project Statement',
    body: `This website is an independent personal project. It is **not affiliated with, endorsed by, sponsored by, or officially connected to** any broker, exchange, proprietary trading firm, financial institution, cryptocurrency wallet provider, software company, or educational organization unless explicitly stated.`,
  },
  {
    title: 'Final Risk Warning',
    body: `Trading is inherently risky. Only trade with capital you can afford to lose. Never rely solely on information found on this website. Always conduct your own research before making financial decisions.`,
  },
];

function renderBody(text) {
  return text.split('\n\n').map((para, i) => {
    if (para.trim().startsWith('-')) {
      const items = para.split('\n').map((l) => l.replace(/^-\s*/, '').trim()).filter(Boolean);
      return (
        <ul key={i} className="list-disc pl-5 space-y-1 my-2 marker:text-sky-400">
          {items.map((it, j) => <li key={j}>{formatInline(it)}</li>)}
        </ul>
      );
    }
    return <p key={i} className="my-2">{formatInline(para)}</p>;
  });
}
function formatInline(text) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    /^\*\*[^*]+\*\*$/.test(p) ? <b key={i} className="text-white">{p.slice(2, -2)}</b> : <span key={i}>{p}</span>
  );
}

export default function LegalPage() {
  return (
    <div className="min-h-screen text-white">
      <div className="container mx-auto px-4 py-16 max-w-3xl">
        <Link href="/" className="inline-flex items-center gap-2 text-sky-300 hover:text-sky-200 mb-8">
          <ArrowLeft className="w-4 h-4" /> Back to UNIBATCH
        </Link>

        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-sky-500 to-cyan-400 flex items-center justify-center">
            <ShieldCheck className="w-6 h-6 text-navy-950" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold">Legal Disclaimer</h1>
            <p className="text-white/50 text-sm">Last updated: July 2026</p>
          </div>
        </div>

        <Card className="glass border-white/10 rounded-3xl">
          <CardContent className="p-8 space-y-6 text-white/80 leading-relaxed">
            {SECTIONS.map((s, i) => (
              <section key={i}>
                <h2 className="text-xl font-bold text-white mb-2">{i + 1}. {s.title}</h2>
                {renderBody(s.body)}
              </section>
            ))}

            <div className="pt-6 border-t border-white/10">
              <div className="text-sky-300 font-semibold text-sm tracking-widest">TRANSPARENCY · DISCIPLINE · COMMUNITY</div>
              <p className="italic text-white/60 text-sm mt-2">&ldquo;Trust should be earned through actions, verified through transparency, and sustained through consistency.&rdquo;</p>
            </div>

            <div className="pt-4 border-t border-white/10 text-xs text-white/40">
              © 2026 Chintu Kushwaha. All Rights Reserved. This website, its design, written content, transparency system, trading journal, fundraising concept, and community structure are original works created by the website owner. Unauthorized copying, redistribution, commercial use, scraping, cloning, or republication of any original material without written permission is prohibited.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
