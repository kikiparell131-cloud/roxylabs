"use client";
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { ArrowRight, Activity, KeyRound, Clock3, BarChart3, RefreshCw, AlertCircle } from 'lucide-react';

type Overview = { requestsToday: number; requestsThisMonth: number; successRate: number; activity: { date: string; requests: number }[]; source: string };
const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/$/, '');
const number = (value: number) => new Intl.NumberFormat('en-US').format(value);
export default function Dashboard() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  async function load() {
    setLoading(true); setError('');
    try {
      const response = await fetch(`${API}/public/overview`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.message || payload.code || `Backend returned HTTP ${response.status}`);
      setData(payload.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect to the API backend.');
      setData(null);
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  const max = Math.max(1, ...(data?.activity || []).map(x => x.requests));
  const stats = [
    ['Requests this month', data ? number(data.requestsThisMonth) : '—', 'Recorded API calls', Activity],
    ['Requests today', data ? number(data.requestsToday) : '—', 'Jakarta day boundary (WIB)', BarChart3],
    ['Remaining quota', 'API key required', 'Quota is checked per API key', KeyRound],
    ['Success rate', data ? `${data.successRate}%` : '—', 'Based on today’s responses', Clock3]
  ] as const;
  return <div className="content">
    <div className="eyebrow">YOUR WORKSPACE</div><h1 className="page-title">Good afternoon, developer ✨</h1>
    <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap',marginTop:18}}><button className="btn btn-soft" onClick={load} disabled={loading}><RefreshCw size={14}/>{loading?'Refreshing…':'Refresh data'}</button><p className="sub" style={{margin:0}}>Statistics are queried from your backend API logs.</p></div>
    <section className="hero" style={{marginTop:24}}><div style={{position:'relative',zIndex:1}}><div className="eyebrow" style={{color:'#cbd4ff'}}>WELCOME TO ROXY MAIN API</div><h2>Let&apos;s make something<br/>amazing today.</h2><p>Your APIs, usage and developer tools — all in one calm, simple workspace.</p><a className="btn" style={{background:'white',color:'#536bd0',marginTop:8}} href="/docs">Explore documentation <ArrowRight size={14}/></a></div><Image src="/roxy/roxy-cat.jpg" width={200} height={240} alt="Roxy mascot"/></section>
    {error && <div className="card" role="alert" style={{marginTop:18,borderColor:'#f0d7b6',color:'#9a6630',display:'flex',gap:12,alignItems:'flex-start'}}><AlertCircle size={18}/><div><strong>Backend connection failed</strong><p style={{margin:'5px 0 0',fontSize:13,lineHeight:1.6}}>{error}</p><p style={{margin:'5px 0 0',fontSize:11}}>Check Railway deployment, NEXT_PUBLIC_API_URL in Vercel, CORS_ORIGINS and the backend Supabase service-role key.</p></div></div>}
    <div className="grid stats">{stats.map(([label,value,foot,Icon])=><div className="card" key={label}><div style={{display:'flex',justifyContent:'space-between'}}><span className="stat-label">{label}</span><Icon size={17} color="#7d8ce0"/></div><div className="stat-value">{loading?'…':value}</div><div className="stat-foot">{foot}</div></div>)}</div>
    <div className="grid two-col"><div className="card"><div className="section-head" style={{marginTop:0}}><h2>API activity</h2><span className="pill">LAST 7 DAYS</span></div>{data?.activity?.length ? <><div style={{height:150,display:'flex',alignItems:'end',gap:12,padding:'12px 4px 0'}}>{data.activity.map((item,i)=><div key={item.date} title={`${item.date}: ${item.requests} requests`} style={{flex:1,height:`${Math.max(4,item.requests/max*100)}%`,borderRadius:'7px 7px 2px 2px',background:i===data.activity.length-1?'#6378dc':'#e4e9ff'}}/>)}</div><div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'#9aa3bb',marginTop:12}}><span>{data.activity[0]?.date}</span><span>{data.activity[3]?.date}</span><span>{data.activity[6]?.date}</span></div></> : <p className="sub">{loading?'Loading API activity…':error?'Activity is unavailable until the backend connection is fixed.':'No API requests have been recorded in the last 7 days.'}</p>}</div><div className="card"><div className="section-head" style={{marginTop:0}}><h2>Quick access</h2></div><div className="character-card"><Image src="/roxy/roxy-blush.jpg" width={100} height={130} alt="Roxy"/><div><strong style={{fontSize:14}}>Need a little help?</strong><p className="sub">Explore endpoints and test your first request with Roxy.</p><a href="/docs" className="btn btn-primary">Open API docs <ArrowRight size={14}/></a></div></div></div></div>
    <p className="footer-note">Analytics source: api_logs. Empty values mean no recorded requests, not sample data. All quota resets use Asia/Jakarta (WIB).</p>
  </div>;
}
