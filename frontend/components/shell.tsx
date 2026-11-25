'use client';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {getAccessToken} from '@/lib/supabase';
import { LayoutDashboard,BookOpen, Gem,Info,UserRound,Shield,Menu,X,Activity } from 'lucide-react';
const API=(process.env.NEXT_PUBLIC_API_URL||(process.env.NODE_ENV==='development'?'http://localhost:4000':'')).replace(/\/$/,'');
const links=[{href:'/dashboard',label:'Dashboard',icon:LayoutDashboard},{href:'/docs',label:'Docs Main API',icon:BookOpen},{href:'/pricing',label:'Pricing',icon:Gem},{href:'/about',label:'About Roxy',icon:Info},{href:'/profile',label:'Profile',icon:UserRound}];
export function Shell({children}:{children:React.ReactNode}){
 const path=usePathname();const [open,setOpen]=useState(false);const [isOwner,setIsOwner]=useState(false);const [systemStatus,setSystemStatus]=useState<'checking'|'online'|'offline'>('checking');
 useEffect(()=>{
  let alive=true;
  async function checkOwner(){try{const token=await getAccessToken();if(!token){if(alive)setIsOwner(false);return;}const r=await fetch(`${API}/dashboard/profile`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});const j=await r.json().catch(()=>({}));if(alive)setIsOwner(r.ok&&j.result?.role==='owner');}catch{if(alive)setIsOwner(false);}}
  void checkOwner();
  async function check(){
   if(!API){if(alive)setSystemStatus('offline');return;}
   try{const r=await fetch(`${API}/health`,{cache:'no-store'});const j=await r.json();if(alive)setSystemStatus(r.ok&&j.database==='connected'?'online':'offline');}
   catch{if(alive)setSystemStatus('offline');}
  }
  void check();const timer=setInterval(check,30000);
  return()=>{alive=false;clearInterval(timer);};
 },[]);
 return <div className="app-shell"><aside className={`sidebar ${open?'open':''}`}><div className="brand"><Image src="/roxy/favicon.jpg" width={40} height={40} alt="Roxy"/><span>ROXY MAIN API<small>POWERED BY ROXY · V1.0.0</small></span></div><div className="nav-label">WORKSPACE</div>{links.map(x=><Link onClick={()=>setOpen(false)} key={x.href} href={x.href} className={`nav-link ${path===x.href?'active':''}`}><x.icon size={17}/>{x.label}</Link>)}<div className="nav-label">MANAGEMENT</div>{isOwner&&<Link onClick={()=>setOpen(false)} href="/admin" className={`nav-link ${path.startsWith('/admin')?'active':''}`}><Shield size={17}/>Admin Dashboard</Link>}<div className="sidebar-bottom"><div style={{display:'flex',alignItems:'center',gap:8}}><Activity size={14}/> {systemStatus==='online'?'All systems operational':systemStatus==='checking'?'Checking services…':'Backend / database unavailable'}</div><div style={{marginTop:9}}>© 2026 Roxy Main API</div></div></aside><main className="main-area"><header className="topbar"><div style={{display:'flex',alignItems:'center',gap:12}}><button className="btn btn-soft mobile-menu" onClick={()=>setOpen(!open)} aria-label="Open menu">{open?<X size={17}/>:<Menu size={17}/>}</button><span className="topbar-title">Developer platform <span style={{color:'#c2c9dc'}}> / </span> {path.split('/')[1]||'home'}</span></div><div className="topbar-right"><span className={`pill ${systemStatus==='online'?'green':'purple'}`}>● {systemStatus==='online'?'SYSTEM ONLINE':systemStatus==='checking'?'CHECKING SYSTEM':'SYSTEM OFFLINE'}</span><Image className="avatar" src="/roxy/roxy-profile.jpg" width={36} height={36} alt="Roxy profile"/></div></header>{children}</main></div>}
