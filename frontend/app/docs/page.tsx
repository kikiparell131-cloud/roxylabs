'use client';
import {useEffect,useMemo,useState} from 'react';
import {Play,Copy,Search,ChevronRight,Clock3,Code2} from 'lucide-react';
import {endpoints as fallback} from '@/lib/data';
type Endpoint={id?:string;source?:string;name:string;path:string;method:string;category:string;plan?:string;description:string;body?:Record<string,unknown>};
const API=(process.env.NEXT_PUBLIC_API_URL||(process.env.NODE_ENV==='development'?'http://localhost:4000':'')).replace(/\/$/,'');
export default function Docs(){
 const [endpoints,setEndpoints]=useState<Endpoint[]>(fallback as Endpoint[]);const [selected,setSelected]=useState<Endpoint>(fallback[1] as Endpoint);
 const [body,setBody]=useState(JSON.stringify((fallback[1] as any).body,null,2));const [key,setKey]=useState('');const [result,setResult]=useState<any>(null);const [busy,setBusy]=useState(false);const [q,setQ]=useState('');
 useEffect(()=>{
  if(!API)return;
  fetch(`${API}/api/v1/endpoints`,{cache:'no-store'})
   .then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.message||j.code||`HTTP ${r.status}`);return j;})
   .then(j=>{if(j.result?.length){setEndpoints(j.result);setSelected(j.result[0]);setBody(JSON.stringify(j.result[0].body||{},null,2));}})
   .catch(e=>console.error('Could not load live endpoint registry:',e));
 },[]);
 const visible=useMemo(()=>endpoints.filter(e=>(e.name+' '+e.category+' '+e.path).toLowerCase().includes(q.toLowerCase())),[q]);
 async function send(){
  setBusy(true);setResult(null);const started=performance.now();
  try{if(!API)throw new Error('NEXT_PUBLIC_API_URL is missing in Vercel.');let parsed={};if(selected.method!=='GET'){parsed=JSON.parse(body);}const r=await fetch(`${API}${selected.path}`,{method:selected.method,headers:{'Content-Type':'application/json','x-api-key':key},body:selected.method==='GET'?undefined:JSON.stringify(parsed)});const data=await r.json().catch(()=>({raw:'Non-JSON response'}));setResult({status:r.status,ok:r.ok,time:Math.round(performance.now()-started),data});}
  catch(e){setResult({error:e instanceof SyntaxError?'Request body is not valid JSON.':String(e)});}
  finally{setBusy(false);}
 }
 const choose=(ep:Endpoint)=>{setSelected(ep);setBody(JSON.stringify(ep.body||{},null,2));setResult(null);};
 const categories=[...new Set(visible.map(x=>x.category))];
 return <div className="content"><div className="eyebrow">DEVELOPER CENTER</div><h1 className="page-title">API Documentation</h1><p className="sub">Browse the registered API modules, inspect request details and execute real requests against the backend.</p>
 <div className="docs-layout"><aside className="card endpoint-list"><div className="search-wrap"><Search size={15}/><input className="field" placeholder="Search endpoints..." value={q} onChange={e=>setQ(e.target.value)}/></div>{categories.map(cat=><div key={cat}><div className="nav-label category-label">{cat.toUpperCase()}</div>{visible.filter(e=>e.category===cat).map(ep=><button key={ep.path} onClick={()=>choose(ep)} className={`endpoint-select ${selected.path===ep.path?'selected':''}`}><span><small>{ep.method}</small><b>{ep.name}</b></span><ChevronRight size={15}/></button>)}</div>)}{!visible.length&&<p className="sub">No endpoints found.</p>}</aside>
 <section className="card endpoint-detail"><div className="endpoint-heading"><div><div className="eyebrow">{selected.category}</div><h2>{selected.name}</h2><p className="sub">{selected.description}</p></div><div className="flex flex-wrap gap-2"><span className={`pill ${selected.plan==='Premium'?'purple':'green'}`}>{(selected.plan||'Free').toUpperCase()}</span>{selected.source==='metadata'&&<span className="pill">METADATA ONLY</span>}</div></div>
 <div className="endpoint-url"><span>{selected.method}</span><code>{API}{selected.path}</code><button title="Copy endpoint URL" onClick={()=>navigator.clipboard?.writeText(`${API}${selected.path}`)}><Copy size={15}/></button></div>
 <div className="section-head"><h2>Request headers</h2><button className="btn btn-soft" onClick={()=>navigator.clipboard?.writeText('Content-Type: application/json\\nx-api-key: YOUR_API_KEY')}><Copy size={13}/> Copy headers</button></div><pre className="code">Content-Type: application/json{"\n"}x-api-key: YOUR_API_KEY</pre>
 <label className="label">YOUR API KEY</label><input className="field" type="password" placeholder="roxy_live_..." value={key} onChange={e=>setKey(e.target.value)}/>
 {selected.method!=='GET'&&<><div className="section-head"><h2>Request body</h2><span className="pill">JSON</span></div><textarea className="field json-editor" rows={8} spellCheck={false} value={body} onChange={e=>setBody(e.target.value)}/></>}
 <div className="execute-row"><button className="btn btn-primary" onClick={send} disabled={busy||!key||selected.source==='metadata'}><Play size={14}/>{busy?'Executing request…':'Execute request'}</button><span className="sub">{selected.source==='metadata'?'This endpoint is documentation metadata only. Add a trusted backend/api/*.js module and redeploy Railway to execute it.':'Requests are sent to the live API backend.'}</span></div>
 <div className="section-head"><h2>Response</h2>{result&&<span className={`pill ${result.ok?'green':'purple'}`}>{result.status?`HTTP ${result.status}`:'ERROR'}</span>}</div>
 {result?<><div className="response-meta"><span><Clock3 size={13}/> {result.time??'—'} ms</span><span><Code2 size={13}/> application/json</span></div><pre className="code response-code">{JSON.stringify(result.data??{error:result.error},null,2)}</pre></>:<pre className="code response-code muted-code">// Your real JSON response will appear here after execution.</pre>}
 </section></div><p className="footer-note">Premium restrictions, API key validation and quota enforcement are performed by the backend, not by this page.</p></div>
}
