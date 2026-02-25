import { useState } from "react";

// Native artifact API call - proxied automatically by Claude.ai, no auth needed
async function callClaude(messages, systemPrompt) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: systemPrompt,
      messages,
    }),
  });
  const data = await response.json();
  if (!data.content) throw new Error('API error: ' + JSON.stringify(data));
  const raw = data.content.map((b) => b.text || '').join('');
  return raw.replace(/```json\n?|```/g, '').trim();
}

const stageConfig = {
  initial:   { label: 'Cold Email',   color: '#7c3aed', bg: '#ede9fe', icon: '✦' },
  followup1: { label: 'Follow-up #1', color: '#a855f7', bg: '#f3e8ff', icon: '◆' },
  followup2: { label: 'Follow-up #2', color: '#ec4899', bg: '#fce7f3', icon: '◎' },
};

const MOCK_CAMPAIGNS = [
  { name: 'SaaS Founders Q1',  leads: 48, replied: 12, meetings: 4,  rate: 25, status: 'Active' },
  { name: 'E-comm Directors',  leads: 32, replied: 8,  meetings: 2,  rate: 25, status: 'Active' },
  { name: 'HR Tech Outreach',  leads: 61, replied: 19, meetings: 7,  rate: 31, status: 'Done'   },
];

export default function App() {
  const [view, setView]           = useState('landing');
  const [appPage, setAppPage]     = useState('dashboard');
  const [offer, setOffer]         = useState('');
  const [icp, setIcp]             = useState('');
  const [emails, setEmails]       = useState([]);
  const [loading, setLoading]     = useState(false);
  const [stage, setStage]         = useState(0);
  const [copied, setCopied]       = useState(null);
  const [error, setError]         = useState(null);

  const sp = () => `You are writing cold outbound emails for B2B founders.
Your goal is to start a simple, natural conversation that gets a reply.

Context about the sender: "${offer}"
Who they are reaching: "${icp}"

CORE PRINCIPLE:
The email should feel like a real person asking a quick question, not like a sales email.

EMAIL 1 STRUCTURE — follow this exact pattern:
1. Start with: hey,
2. One single clear question about how they currently handle something relevant

EXAMPLE:
hey,
how are you running payroll right now?

EMAIL 1 RULES:
- Only 2-3 lines total
- Only ONE main question
- No explanations, no pitch, no product mention, no benefits
- No "we help", no "we built", no selling
- No "Curious how...", no "I wanted to reach out", no "Hope you're doing well"
- Must sound like spoken language, not written content
- Casual, human, slightly imperfect, like a quick message
- NEVER use a dash anywhere in the email. No dashes. Ever.

QUESTION STYLE — use patterns like:
- "how are you handling X right now?"
- "are you still doing X manually?"
- "is X something you've already figured out?"
- "are you doing X in-house or using something?"

SUBJECT LINE: 2-4 words, simple and human. No marketing language. Examples: "payroll question", "quick question", "about payroll"

FOLLOW-UP 1: Reference a pattern from talking to similar founders. Short, casual, still no pitch. Different angle from email 1. No dashes.

FOLLOW-UP 2: Name the problem plainly. Hint you have been working on something related. End casually like "happy to share if its useful". No dashes.

CRITICAL: Return ONLY raw JSON. No markdown. No backticks. No explanation.
For emails: {"subject":"...","body":"..."}`;

  async function runOutreach() {
    setEmails([]); setStage(0); setLoading(true); setError(null);
    const all = [];
    try {
      // Step 1: Cold email
      const coldRaw = await callClaude([{ role: 'user', content: `Write a cold outbound email to someone matching this profile: ${icp}. Make it personal and specific.` }], sp());
      const cold = JSON.parse(coldRaw);
      all.push({ stage: 'initial', from: 'you', ...cold });
      setEmails([...all]); setStage(1);

      // Step 2: Follow-up 1
      const fu1Raw = await callClaude([
        { role: 'user',      content: `Write a cold email to someone matching: ${icp}` },
        { role: 'assistant', content: JSON.stringify(cold) },
        { role: 'user',      content: `3 days passed, no reply. Write follow-up #1. Different angle. Casual. No guilt.` },
      ], sp());
      const fu1 = JSON.parse(fu1Raw);
      all.push({ stage: 'followup1', from: 'you', ...fu1 });
      setEmails([...all]); setStage(2);

      // Step 3: Follow-up 2
      const fu2Raw = await callClaude([{ role: 'user', content: `Write a final follow-up email (day 7). Feel like a last attempt. Direct, friendly, different hook than before.` }], sp());
      const fu2 = JSON.parse(fu2Raw);
      all.push({ stage: 'followup2', from: 'you', ...fu2 });
      setEmails([...all]); setStage(3);



    } catch (e) {
      console.error(e);
      setError('Something went wrong: ' + e.message);
    }
    setLoading(false);
  }

  function copy(body, idx) {
    navigator.clipboard.writeText(body);
    setCopied(idx);
    setTimeout(() => setCopied(null), 1500);
  }

  if (view === 'landing') return <Landing onStart={() => { setView('app'); setAppPage('dashboard'); }} />;

  return (
    <div style={{ display:'flex', height:'100vh', background:'#f9fafb', fontFamily:"'Inter',sans-serif", overflow:'hidden' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        .fu{animation:fadeUp .3s ease forwards;}
        textarea:focus{outline:none;border-color:#7c3aed!important;box-shadow:0 0 0 3px rgba(124,58,237,.1);}
        ::-webkit-scrollbar{width:4px;}::-webkit-scrollbar-thumb{background:#e5e7eb;border-radius:4px;}
      `}</style>

      {/* Sidebar */}
      <aside style={{ width:220, background:'#fff', borderRight:'1px solid #f0f0f0', display:'flex', flexDirection:'column', padding:'20px 0', flexShrink:0 }}>
        <div style={{ padding:'0 20px 28px', display:'flex', alignItems:'center', gap:8 }}>
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" style={{borderRadius:8}}>
            <rect width="32" height="32" rx="8" fill="url(#sid)"/>
            <defs><linearGradient id="sid" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse"><stop stopColor="#7c3aed"/><stop offset="1" stopColor="#a855f7"/></linearGradient></defs>
            <path d="M21 10H14C11.79 10 10 11.79 10 14v4c0 2.21 1.79 4 4 4h7" stroke="white" strokeWidth="2.2" strokeLinecap="round"/>
            <path d="M17.5 14l3.5 2-3.5 2" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span style={{ fontWeight:700, fontSize:18, color:'#7c3aed', letterSpacing:'-0.5px' }}>Closr</span>
        </div>
        <div style={{ padding:'0 12px 8px' }}>
          <p style={{ fontSize:10, fontWeight:600, color:'#9ca3af', letterSpacing:'0.1em', textTransform:'uppercase', padding:'0 8px 8px' }}>Workspace</p>
          {[
            { id:'dashboard', label:'Dashboard',       icon:'▦' },
            { id:'campaign',  label:'Launch Outbound', icon:'✦' },
            { id:'sequences', label:'Sequences',       icon:'◆' },
            { id:'leads',     label:'Leads',           icon:'◎' },
          ].map(item => (
            <button key={item.id} onClick={() => setAppPage(item.id)} style={{
              width:'100%', display:'flex', alignItems:'center', gap:10, padding:'9px 12px', borderRadius:8, border:'none', cursor:'pointer', fontSize:14, fontWeight:500, marginBottom:2,
              background: appPage===item.id ? '#f5f3ff' : 'transparent',
              color:       appPage===item.id ? '#7c3aed'  : '#6b7280',
              transition:'all .15s',
            }}>
              <span style={{ fontSize:12, opacity:.8 }}>{item.icon}</span> {item.label}
            </button>
          ))}
        </div>
        <div style={{ marginTop:'auto', padding:'16px 20px', borderTop:'1px solid #f3f4f6' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ width:32, height:32, borderRadius:'50%', background:'linear-gradient(135deg,#7c3aed,#a855f7)', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontWeight:700, fontSize:13 }}>U</div>
            <div>
              <p style={{ fontSize:13, fontWeight:600, color:'#111827' }}>Your Account</p>
              <p style={{ fontSize:11, color:'#9ca3af' }}>Free Plan</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <header style={{ height:56, background:'#fff', borderBottom:'1px solid #f0f0f0', display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 32px', flexShrink:0 }}>
          <h1 style={{ fontSize:16, fontWeight:600, color:'#111827' }}>
            {{ dashboard:'Dashboard', campaign:'Launch Outbound', sequences:'Sequences', leads:'Leads' }[appPage]}
          </h1>
          <button onClick={() => setView('landing')} style={{ padding:'6px 16px', borderRadius:8, border:'1px solid #e5e7eb', background:'#fff', fontSize:13, fontWeight:500, color:'#374151', cursor:'pointer' }}>Home</button>
        </header>

        <main style={{ flex:1, overflow:'auto', padding:32 }}>
          {appPage === 'dashboard' && <Dashboard onLaunch={() => setAppPage('campaign')} />}
          {appPage === 'campaign'  && (
            <Campaign
              offer={offer} setOffer={setOffer} icp={icp} setIcp={setIcp}
              emails={emails} loading={loading} stage={stage}
              error={error} copied={copied}
              onRun={runOutreach} onCopy={copy}
            />
          )}
          {appPage === 'sequences' && <Placeholder icon="◆" title="Active Sequences" desc="Your running outreach sequences and their performance will appear here." />}
          {appPage === 'leads'     && <Placeholder icon="◎" title="Your Leads" desc="Everyone we're reaching out to on your behalf lives here." />}
        </main>
      </div>
    </div>
  );
}

function Dashboard({ onLaunch }) {
  const stats = [
    { label:'Interested Leads',       value:'141', icon:'◎', color:'#7c3aed', bg:'#ede9fe' },
    { label:'Conversations Started',  value:'423', icon:'◆', color:'#a855f7', bg:'#f3e8ff' },
    { label:'Replies',                value:'39',  icon:'◎', color:'#10b981', bg:'#d1fae5' },
    { label:'Meetings Booked',        value:'13',  icon:'★', color:'#f59e0b', bg:'#fef3c7' },
  ];
  return (
    <div className="fu">
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:16, marginBottom:24 }}>
        {stats.map(s => (
          <div key={s.label} style={{ background:'#fff', borderRadius:12, padding:'20px 24px', border:'1px solid #f3f4f6' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
              <span style={{ fontSize:14, color:'#6b7280', fontWeight:500 }}>{s.label}</span>
              <div style={{ width:36, height:36, borderRadius:10, background:s.bg, display:'flex', alignItems:'center', justifyContent:'center', color:s.color, fontSize:16 }}>{s.icon}</div>
            </div>
            <p style={{ fontSize:32, fontWeight:800, color:'#111827', lineHeight:1 }}>{s.value}</p>
            <p style={{ fontSize:12, color:'#10b981', marginTop:6, fontWeight:500 }}>+ 12% this week</p>
          </div>
        ))}
      </div>

      <div style={{ background:'#fff', borderRadius:12, border:'1px solid #f3f4f6', marginBottom:20 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'20px 24px', borderBottom:'1px solid #f9fafb' }}>
          <h2 style={{ fontSize:15, fontWeight:600, color:'#111827' }}>Active Campaigns</h2>
          <button onClick={onLaunch} style={{ padding:'8px 16px', borderRadius:8, border:'none', background:'#7c3aed', color:'#fff', fontSize:13, fontWeight:600, cursor:'pointer' }}>+ Launch</button>
        </div>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr style={{ borderBottom:'1px solid #f3f4f6' }}>
              {['Campaign','Leads','Replied','Meetings','Reply Rate','Status'].map(h => (
                <th key={h} style={{ padding:'10px 24px', textAlign: h==='Campaign'?'left':'center', fontSize:11, fontWeight:600, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.05em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MOCK_CAMPAIGNS.map((c,i) => (
              <tr key={i} style={{ borderBottom: i<2 ? '1px solid #f9fafb':'none' }}>
                <td style={{ padding:'16px 24px', fontSize:14, fontWeight:500, color:'#111827' }}>{c.name}</td>
                <td style={{ padding:'16px 24px', textAlign:'center', fontSize:14, color:'#374151' }}>{c.leads}</td>
                <td style={{ padding:'16px 24px', textAlign:'center', fontSize:14, color:'#374151' }}>{c.replied}</td>
                <td style={{ padding:'16px 24px', textAlign:'center', fontSize:14, color:'#374151' }}>{c.meetings}</td>
                <td style={{ padding:'16px 24px', textAlign:'center' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, justifyContent:'center' }}>
                    <div style={{ width:80, height:6, background:'#f3f4f6', borderRadius:3, overflow:'hidden' }}>
                      <div style={{ width:`${c.rate}%`, height:'100%', background:'#7c3aed', borderRadius:3 }} />
                    </div>
                    <span style={{ fontSize:13, fontWeight:600, color:'#7c3aed' }}>{c.rate}%</span>
                  </div>
                </td>
                <td style={{ padding:'16px 24px', textAlign:'center' }}>
                  <span style={{ padding:'4px 10px', borderRadius:20, fontSize:12, fontWeight:500, background: c.status==='Active'?'#d1fae5':'#f3f4f6', color: c.status==='Active'?'#059669':'#6b7280' }}>
                    {c.status==='Active'?'• ':''}{c.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ background:'linear-gradient(135deg,#7c3aed,#a855f7)', borderRadius:12, padding:'28px 32px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div>
          <h3 style={{ fontSize:18, fontWeight:700, color:'#fff', marginBottom:6 }}>Ready to get more replies?</h3>
          <p style={{ fontSize:13, color:'rgba(255,255,255,.75)' }}>Tell us who to reach. We handle everything from first touch to booked meeting.</p>
        </div>
        <button onClick={onLaunch} style={{ padding:'12px 24px', borderRadius:10, border:'1px solid rgba(255,255,255,.3)', background:'rgba(255,255,255,.15)', color:'#fff', fontSize:14, fontWeight:600, cursor:'pointer' }}>
          Launch Outbound →
        </button>
      </div>
    </div>
  );
}

function Campaign({ offer, setOffer, icp, setIcp, emails, loading, stage, error, copied, onRun, onCopy }) {
  const stageList = ['initial','followup1','followup2'];
  const canRun = offer.trim() && icp.trim() && !loading;

  return (
    <div className="fu" style={{ maxWidth:900 }}>
      {/* Hero */}
      <div style={{ background:'linear-gradient(135deg,#f5f3ff,#fdf4ff)', border:'1px solid #ede9fe', borderRadius:16, padding:'32px 40px', textAlign:'center', marginBottom:28 }}>
        <h2 style={{ fontSize:22, fontWeight:700, color:'#1f2937', marginBottom:6 }}>Launch your outbound ✦</h2>
        <p style={{ fontSize:14, color:'#6b7280' }}>Tell us who to reach and what you offer. We run the outreach, follow up automatically, and bring you replies.</p>
      </div>

      {/* Inputs */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20, marginBottom:20 }}>
        <div style={{ background:'#fff', borderRadius:12, border:'1px solid #f3f4f6', padding:24 }}>
          <label style={{ fontSize:11, fontWeight:700, color:'#7c3aed', letterSpacing:'0.1em', textTransform:'uppercase', display:'block', marginBottom:12 }}>What do you sell?</label>
          <textarea value={offer} onChange={e=>setOffer(e.target.value)} rows={5} placeholder="e.g. A B2B SaaS tool that automates payroll for startups under 50 people..." style={{ width:'100%', border:'1px solid #e5e7eb', borderRadius:8, padding:'12px 14px', fontSize:14, color:'#374151', fontFamily:'inherit', resize:'vertical', background:'#fafafa' }} />
        </div>
        <div style={{ background:'#fff', borderRadius:12, border:'1px solid #f3f4f6', padding:24 }}>
          <label style={{ fontSize:11, fontWeight:700, color:'#7c3aed', letterSpacing:'0.1em', textTransform:'uppercase', display:'block', marginBottom:12 }}>Who should we reach?</label>
          <textarea value={icp} onChange={e=>setIcp(e.target.value)} rows={5} placeholder="e.g. HR managers or founders at Series A startups in the US, 10–50 employees..." style={{ width:'100%', border:'1px solid #e5e7eb', borderRadius:8, padding:'12px 14px', fontSize:14, color:'#374151', fontFamily:'inherit', resize:'vertical', background:'#fafafa' }} />
        </div>
      </div>

      {/* Stage visualiser */}
      <div style={{ background:'#fff', borderRadius:12, border:'1px solid #f3f4f6', padding:'24px 32px', marginBottom:24 }}>
        <p style={{ fontSize:11, fontWeight:700, color:'#9ca3af', letterSpacing:'0.1em', textTransform:'uppercase', textAlign:'center', marginBottom:24 }}>Sequence Preview</p>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center' }}>
          {stageList.map((s, i) => {
            const cfg = stageConfig[s];
            const done   = stage > i+1;
            const active = stage === i+1;
            return (
              <div key={s} style={{ display:'flex', alignItems:'center' }}>
                <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:10 }}>
                  <div style={{ width:44, height:44, borderRadius:12, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, background: done||active ? cfg.bg : '#f9fafb', border:`2px solid ${done||active ? cfg.color+'40' : '#e5e7eb'}`, transition:'all .4s', boxShadow: active ? `0 0 0 4px ${cfg.color}20` : 'none' }}>{cfg.icon}</div>
                  <span style={{ fontSize:10, fontWeight:700, color: done||active ? cfg.color : '#9ca3af', letterSpacing:'0.05em', textTransform:'uppercase', textAlign:'center', maxWidth:80 }}>{cfg.label}</span>
                </div>
                {i < stageList.length-1 && <div style={{ width:40, height:2, background: stage>i+1 ? '#7c3aed' : '#e5e7eb', margin:'0 4px', marginBottom:28, transition:'all .4s' }} />}
              </div>
            );
          })}
        </div>
      </div>

      {/* CTA */}
      <div style={{ textAlign:'center', marginBottom:32 }}>
        <button onClick={onRun} disabled={!canRun} style={{ padding:'14px 36px', borderRadius:12, border:'none', background:'linear-gradient(135deg,#7c3aed,#a855f7)', color:'#fff', fontSize:15, fontWeight:700, cursor: canRun?'pointer':'not-allowed', opacity: canRun?1:0.5, boxShadow:'0 4px 14px rgba(124,58,237,.35)', transition:'all .2s' }}>
          {loading ? 'Outreach running…' : 'Start Outreach →'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={{ background:'#fef2f2', border:'1px solid #fecaca', borderRadius:10, padding:'14px 18px', color:'#dc2626', fontSize:13, marginBottom:16 }}>
          ⚠ {error}
        </div>
      )}

      {/* Success banner */}
      {emails.length === 3 && (
        <div style={{ background:'linear-gradient(135deg,#f0fdf4,#eff6ff)', border:'1px solid #bbf7d0', borderRadius:12, padding:'20px 28px', textAlign:'center', marginBottom:20 }}>
          <p style={{ fontSize:20, fontWeight:700, color:'#059669' }}>Outbound ready. Your 3-touch sequence is set. 🎯</p>
          <p style={{ fontSize:13, color:'#6b7280', marginTop:4 }}>Cold email + 2 follow-ups, ready to send</p>
        </div>
      )}

      {/* Emails */}
      {emails.map((email, idx) => {
        const cfg = stageConfig[email.stage];
        return (
          <div key={idx} className="fu" style={{ background:'#fff', borderRadius:12, border:'1px solid #f3f4f6', marginBottom:12, overflow:'hidden' }}>
            <div style={{ padding:'14px 20px', borderBottom:'1px solid #f9fafb', display:'flex', alignItems:'center', justifyContent:'space-between', background: email.from==='prospect'?'#f0fdf4':'#fff' }}>
              <span style={{ fontSize:11, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:cfg.color, background:cfg.bg, padding:'4px 10px', borderRadius:20 }}>{cfg.label}</span>
              <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                <span style={{ fontSize:12, color:'#9ca3af' }}>{email.from==='you' ? 'You → Prospect' : 'Prospect → You'}</span>
                {email.from==='you' && (
                  <button onClick={() => onCopy(email.body, idx)} style={{ fontSize:11, color:'#6b7280', background:'#f9fafb', border:'1px solid #e5e7eb', borderRadius:6, padding:'4px 10px', cursor:'pointer' }}>
                    {copied===idx ? '✓ copied' : 'copy'}
                  </button>
                )}
              </div>
            </div>
            {email.subject && <div style={{ padding:'10px 20px 4px', fontSize:12, color:'#9ca3af' }}>Subject: <span style={{ color:'#374151' }}>{email.subject}</span></div>}
            <div style={{ padding:'8px 20px 18px', fontSize:14, lineHeight:1.8, color:'#374151', whiteSpace:'pre-wrap' }}>{email.body}</div>
          </div>
        );
      })}

      {/* Loading indicator */}
      {loading && (
        <div style={{ background:'#f9fafb', border:'1px dashed #e5e7eb', borderRadius:12, padding:24, textAlign:'center', color:'#9ca3af', fontSize:13 }}>
          {stage===0 && '→ Writing cold email…'}
          {stage===1 && '→ Writing follow-up #1…'}
          {stage===2 && '→ Writing follow-up #2…'}
        </div>
      )}
    </div>
  );
}

function Placeholder({ icon, title, desc }) {
  return (
    <div className="fu" style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'60vh', flexDirection:'column', gap:16 }}>
      <div style={{ width:64, height:64, borderRadius:16, background:'#f5f3ff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:28, color:'#7c3aed' }}>{icon}</div>
      <h2 style={{ fontSize:20, fontWeight:700, color:'#111827' }}>{title}</h2>
      <p style={{ fontSize:14, color:'#9ca3af' }}>{desc}</p>
    </div>
  );
}

function Landing({ onStart }) {
  return (
    <div style={{ minHeight:'100vh', background:'#f8f8fb', fontFamily:"'Inter',sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
        .f0{animation:fadeUp .6s ease forwards;}
        .f1{animation:fadeUp .6s ease .15s forwards;opacity:0;}
        .feat-card{transition:transform .2s ease,box-shadow .2s ease;cursor:default;}
        .feat-card:hover{transform:translateY(-6px);box-shadow:0 16px 40px rgba(124,58,237,.12);}
      `}</style>

      <nav style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'20px 60px', background:'#fff', borderBottom:'1px solid #f0f0f0' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <svg width="34" height="34" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" style={{borderRadius:8}}>
            <rect width="32" height="32" rx="8" fill="url(#nav)"/>
            <defs><linearGradient id="nav" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse"><stop stopColor="#7c3aed"/><stop offset="1" stopColor="#a855f7"/></linearGradient></defs>
            <path d="M21 10H14C11.79 10 10 11.79 10 14v4c0 2.21 1.79 4 4 4h7" stroke="white" strokeWidth="2.2" strokeLinecap="round"/>
            <path d="M17.5 14l3.5 2-3.5 2" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span style={{ fontWeight:700, fontSize:20, color:'#7c3aed', letterSpacing:'-0.5px' }}>Closr</span>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:36 }}>
          {['Features','Pricing','About'].map(item => (
            <a key={item} href="#" style={{ fontSize:14, fontWeight:500, color:'#374151', textDecoration:'none' }}>{item}</a>
          ))}
          <button onClick={onStart} style={{ padding:'10px 22px', borderRadius:10, border:'none', background:'linear-gradient(135deg,#7c3aed,#a855f7)', color:'#fff', fontSize:14, fontWeight:600, cursor:'pointer' }}>Get Started Free</button>
        </div>
      </nav>

      <section style={{ padding:'80px 60px 60px', display:'flex', alignItems:'center', gap:60, maxWidth:1200, margin:'0 auto' }}>
        <div style={{ flex:1 }} className="f0">
          <div style={{ display:'inline-flex', alignItems:'center', gap:8, background:'#fff', border:'1px solid #e5e7eb', borderRadius:20, padding:'6px 14px', fontSize:13, color:'#7c3aed', fontWeight:500, marginBottom:28 }}>
            <span style={{ width:6, height:6, borderRadius:'50%', background:'#7c3aed', display:'inline-block' }} /> Your Outbound, Running 24/7
          </div>
          <h1 style={{ fontSize:52, fontWeight:900, lineHeight:1.1, color:'#111827', marginBottom:12 }}>
            We run your<br />outbound.<br />
            <span style={{ color:'#7c3aed' }}>You close the deals.</span>
          </h1>
          <p style={{ fontSize:16, color:'#6b7280', lineHeight:1.7, marginBottom:36, maxWidth:420 }}>
            Tell us who you want to reach. We handle the outreach, the follow-ups, and the replies. You just show up to the meetings.
          </p>
          <div style={{ display:'flex', alignItems:'center', gap:16 }}>
            <button onClick={onStart} style={{ padding:'14px 28px', borderRadius:12, border:'none', background:'linear-gradient(135deg,#7c3aed,#a855f7)', color:'#fff', fontSize:15, fontWeight:700, cursor:'pointer', boxShadow:'0 4px 20px rgba(124,58,237,.3)' }}>
              Launch My Outbound →
            </button>
            <span style={{ fontSize:13, color:'#9ca3af' }}>No credit card needed</span>
          </div>
          <div style={{ display:'flex', gap:32, marginTop:36 }}>
            {[['5-step','Runs for you'],['< 60s','To go live'],['3x','More replies']].map(([val,lbl]) => (
              <div key={lbl}>
                <p style={{ fontSize:22, fontWeight:800, color:'#111827' }}>{val}</p>
                <p style={{ fontSize:13, color:'#9ca3af', marginTop:2 }}>{lbl}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="f1" style={{ flex:1, background:'#fff', borderRadius:16, boxShadow:'0 20px 60px rgba(0,0,0,.08)', overflow:'hidden', border:'1px solid #f0f0f0' }}>
          <div style={{ padding:'14px 20px', borderBottom:'1px solid #f9fafb', display:'flex', alignItems:'center', gap:8 }}>
            <div style={{ width:10, height:10, borderRadius:'50%', background:'#ef4444' }} />
            <div style={{ width:10, height:10, borderRadius:'50%', background:'#f59e0b' }} />
            <div style={{ width:10, height:10, borderRadius:'50%', background:'#10b981' }} />
            <span style={{ fontSize:12, fontWeight:600, color:'#9ca3af', letterSpacing:'0.08em', textTransform:'uppercase', marginLeft:'auto' }}>Closr · Live Outbound</span>
          </div>
          {[
            { label:'Cold Email',        msg:"Hey Sarah, noticed Acme is scaling fast...",              color:'#7c3aed', bg:'#ede9fe' },
            { label:'Follow-up #1',      msg:"Would love to show you the ROI other founders are seeing...", color:'#a855f7', bg:'#f3e8ff' },
            { label:'Follow-up #2',      msg:"Last one from me. If timing is off, totally get it...",   color:'#ec4899', bg:'#fce7f3' },
            { label:'They Replied ✓',    msg:"Hey, actually looks interesting. Tell me more...",        color:'#10b981', bg:'#d1fae5' },
            { label:'Meeting Booked 🎉', msg:"Great! Free Tuesday at 2pm for 20 min?",                 color:'#f59e0b', bg:'#fef3c7' },
          ].map((item,i) => (
            <div key={i} style={{ padding:'16px 20px', borderBottom: i<4?'1px solid #f9fafb':'none', display:'flex', alignItems:'center', gap:14 }}>
              <span style={{ fontSize:11, fontWeight:700, color:item.color, background:item.bg, padding:'4px 10px', borderRadius:20, whiteSpace:'nowrap' }}>{item.label}</span>
              <span style={{ fontSize:13, color:'#6b7280' }}>{item.msg}</span>
            </div>
          ))}
        </div>
      </section>

      <section style={{ padding:'60px 60px 80px', maxWidth:1200, margin:'0 auto' }}>
        <p style={{ fontSize:12, fontWeight:700, color:'#7c3aed', letterSpacing:'0.15em', textTransform:'uppercase', textAlign:'center', marginBottom:12 }}>What we do for you</p>
        <h2 style={{ fontSize:36, fontWeight:800, color:'#111827', textAlign:'center', marginBottom:48 }}>Your outbound runs. You just close.</h2>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:20, alignItems:'stretch' }}>
          {[
            { icon:'📋', color:'#7c3aed', bg:'#ede9fe', title:'Set up in under a minute',      desc:"Add your offer, describe your ideal customer, and upload your leads as a CSV. That is all we need to get started." },
            { icon:'✦', color:'#10b981', bg:'#d1fae5', title:'We run your outreach',          desc:"First touch, follow-up #1, follow-up #2, sent for you automatically. Nothing to manage." },
            { icon:'◎', color:'#a855f7', bg:'#f3e8ff', title:'See replies before they happen', desc:"We simulate how prospects respond so you know exactly what kind of conversations to expect." },
            { icon:'◆', color:'#f59e0b', bg:'#fef3c7', title:'Every message is personal',      desc:"Each lead gets outreach written specifically for them. Not a template. Not a blast." },
            { icon:'▦', color:'#a855f7', bg:'#f3e8ff', title:'Replies and meetings, in one place', desc:"Track who responded, who's interested, and how many meetings are on the calendar." },
            { icon:'⊕', color:'#ec4899', bg:'#fce7f3', title:'Your pipeline grows automatically', desc:"While you focus elsewhere, your outbound is running. New conversations start every day." },

          ].map(f => (
            <div key={f.title} className="feat-card" style={{ background:'#fff', borderRadius:16, padding:'32px 28px 36px', border:'1px solid #efefef', display:'flex', flexDirection:'column', alignItems:'flex-start' }}>
              <div style={{ width:56, height:56, borderRadius:14, background:f.bg, display:'flex', alignItems:'center', justifyContent:'center', fontSize:24, color:f.color, marginBottom:28, flexShrink:0 }}>{f.icon}</div>
              <h3 style={{ fontSize:15, fontWeight:700, color:'#111827', marginBottom:10, textAlign:'center', width:'100%' }}>{f.title}</h3>
              <p style={{ fontSize:13.5, color:'#6b7280', lineHeight:1.65, margin:0, textAlign:'center', width:'100%' }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA Section */}
      <section style={{ background:'linear-gradient(135deg,#7c3aed,#6d28d9)', padding:'80px 60px' }}>
        <div style={{ maxWidth:720, margin:'0 auto', textAlign:'center' }}>
          <p style={{ fontSize:13, fontWeight:700, color:'rgba(255,255,255,.6)', letterSpacing:'0.15em', textTransform:'uppercase', marginBottom:16 }}>Get started today</p>
          <h2 style={{ fontSize:42, fontWeight:900, color:'#fff', lineHeight:1.15, marginBottom:20 }}>
            Your next client is<br />already out there.
          </h2>
          <p style={{ fontSize:17, color:'rgba(255,255,255,.75)', lineHeight:1.7, marginBottom:40, maxWidth:480, margin:'0 auto 40px' }}>
            We reach them, follow up, and bring you the reply. You just decide who to meet.
          </p>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:16 }}>
            <button onClick={onStart} style={{ padding:'16px 36px', borderRadius:12, border:'none', background:'#fff', color:'#7c3aed', fontSize:16, fontWeight:800, cursor:'pointer', boxShadow:'0 4px 20px rgba(0,0,0,.15)' }}>
              Start for Free
            </button>
            <span style={{ fontSize:14, color:'rgba(255,255,255,.5)' }}>No credit card needed</span>
          </div>
          <div style={{ display:'flex', justifyContent:'center', gap:40, marginTop:48, paddingTop:40, borderTop:'1px solid rgba(255,255,255,.15)' }}>
            {[['141+','Leads sourced'],['3x','Reply rate'],['< 60s','To go live']].map(([val,lbl]) => (
              <div key={lbl} style={{ textAlign:'center' }}>
                <p style={{ fontSize:28, fontWeight:900, color:'#fff' }}>{val}</p>
                <p style={{ fontSize:13, color:'rgba(255,255,255,.5)', marginTop:4 }}>{lbl}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
