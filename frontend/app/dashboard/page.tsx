'use client';
import Image from 'next/image';
import {useEffect,useState} from 'react';
import {Activity,KeyRound,Clock3,BarChart3,ArrowRight,RefreshCw,AlertCircle} from 'lucide-react';
import {getAccessToken,getSupabase} from '@/lib/supabase';
const API=process.env.NEXT_PUBLIC_API_URL||'http://localhost:4000';
type Overview={requestsToday:number;requestsMonth:number;remainingQuota:number;dailyLimit:number;successRate:number;activeKeys:number;plan:string;activity:{date:string;count:number}[]};
export default function Dashboard(){
 const [data,setData]=useState<Overview|null>(null);const [logs,setLogs]=useState<any[]>([]);const [busy,setBusy]=useState(true);const [error,setError]=useState('');
 async function load(){
  setBusy(true);setError('');
  try{const token=await getAccessToken();if(!token){location.href='/login';return;}
   const headers={Authorization:`Bearer ${token}`};
   const [a,b]=await Promise.all([fetch(`${API}/dashboard/overview`,{headers,cache:'no-store'}),fetch(`${API}/dashboard/logs?limit=8`,{headers,cache:'no-store'})]);
   const aj=await a.json();const bj=await b.json();if(!a.ok)throw new Error(aj.error||aj.code||'Could not load dashboard');
   setData(aj.result);setLogs(bj.result||[]);
  }catch(e){setError(String(e));}finally{setBusy(false);}
 }
 useEffect(()=>{void load();},[]);
 const max=Math.max(1,...(data?.activity||[]).map(x=>x.count));
 const cards=[{label:'Requests this month',value:data?.requestsMonth??'—',foot:'Recorded API calls',icon:Activity},{label:'Requests today',value:data?.requestsToday??'—',foot:`${data?.dailyLimit??'—'} daily limit`,icon:BarChart3},{label:'Remaining quota',value:data?.remainingQuota??'—',foot:`${data?.plan||'—'} plan`,icon:KeyRound},{label:'Success rate',value:data?`${data.successRate}%`:'—',foot:'Based on today’s responses',icon:Clock3}];
 return <div className="content"><div className="eyebrow">YOUR WORKSPACE</div><div className="flex flex-wrap items-center justify-between gap-3"><h1 className="page-title">Good afternoon, developer ✨</h1><button className="btn btn-soft" onClick={load}><RefreshCw size={14}/> Refresh data</button></div><p className="sub">Your API workspace at a glance. Statistics below are loaded from your actual API logs.</p>
 <section className="hero" style={{marginTop:24}}><div style={{position:'relative',zIndex:1}}><div className="eyebrow" style={{color:'#cbd4ff'}}>WELCOME TO ROXY MAIN API</div><h2>Let&apos;s make something<br/>amazing today.</h2><p>Your APIs, usage and developer tools — all in one calm, simple workspace.</p><a className="btn" style={{background:'white',color:'#536bd0',marginTop:8}} href="/docs">Explore documentation <ArrowRight size={14}/></a></div><Image src="/roxy/roxy-cat.jpg" width={200} height={240} alt="Roxy mascot"/></section>
 {error&&<div className="card" style={{marginTop:20,color:'#b45309',display:'flex',gap:10}}><AlertCircle size={18}/><span>{error}. Check that backend and Supabase are configured.</span></div>}
 <div className="grid stats">{cards.map(({label,value,foot,icon:Icon})=><div className="card" key={label}><div style={{display:'flex',justifyContent:'space-between'}}><span className="stat-label">{label}</span><Icon size={17} color="#7d8ce0"/></div><div className="stat-value">{busy?'…':String(value)}</div><div className="stat-foot">{foot}</div></div>)}</div>
 <div className="grid two-col"><div className="card"><div className="section-head" style={{marginTop:0}}><h2>API activity</h2><span className="pill">LAST 7 DAYS</span></div><div className="activity-chart">{(data?.activity||Array.from({length:7},(_,i)=>({date:'',count:0}))).map((d,i)=><div key={i} className="activity-column"><div title={`${d.count} requests`} style={{height:`${Math.max(3,d.count/max*100)}%`}}/><small>{d.date?new Date(d.date+'T00:00:00').toLocaleDateString('en',{weekday:'short'}):'—'}</small></div>)}</div></div>
 <div className="card"><div className="section-head" style={{marginTop:0}}><h2>Recent API requests</h2><a href="/profile" className="muted">API keys →</a></div>{logs.length?logs.map(l=><div key={l.id} className="log-row"><div><strong>{l.endpoint}</strong><small>{new Date(l.created_at).toLocaleString()}</small></div><span className={`pill ${l.status_code<400?'green':'purple'}`}>{l.status_code} · {l.response_time_ms}ms</span></div>):<p className="sub">{busy?'Loading requests…':'No API requests recorded yet.'}</p>}</div></div>
 <p className="footer-note">{busy?'Loading live workspace data…':'Live data from Roxy Main API · Timezone: Asia/Jakarta (WIB).'}</p></div>
}
