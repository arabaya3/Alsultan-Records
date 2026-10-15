(()=>{
  const cfg=window.SULTAN_CMS||{};
  const esc=(s='')=>String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  let sbPromise=null;
  async function getSB(){
    if(sbPromise)return sbPromise;
    sbPromise=(async()=>{if(!cfg.supabaseUrl)return null;const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');return createClient(cfg.supabaseUrl,cfg.supabaseAnonKey)})();
    return sbPromise;
  }
  function publicUrl(sb,x){if(/^https?:\/\//i.test(x?.public_url||''))return x.public_url;if(x?.bucket_id&&x?.storage_path){try{return sb.storage.from(x.bucket_id).getPublicUrl(x.storage_path).data.publicUrl||''}catch{}}return ''}

  // PWA registration. Never cache authenticated API responses in the service worker.
  if('serviceWorker' in navigator && location.protocol==='https:') addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));

  // Custom video player: native MP4/HLS + dynamic hls.js fallback.
  async function mountPlayer(host,{src,poster='',title=''}){
    if(!host||!src)return;
    host.innerHTML=`<div class="v26-player"><video playsinline preload="metadata" ${poster?`poster="${esc(poster)}"`:''}></video><div class="v26-player-title">${esc(title||'Sultan Film')}</div><div class="v26-player-badge">SULTAN FILM</div><div class="v26-player-ui"><button type="button" class="v26-play" aria-label="تشغيل">▶</button><input class="v26-seek" type="range" min="0" max="100" value="0" aria-label="التقدم"><button type="button" class="v26-mute" aria-label="الصوت">🔊</button><button type="button" class="v26-fullscreen" aria-label="ملء الشاشة">⛶</button></div></div>`;
    const wrap=host.firstElementChild,v=wrap.querySelector('video'),play=wrap.querySelector('.v26-play'),seek=wrap.querySelector('.v26-seek'),mute=wrap.querySelector('.v26-mute'),full=wrap.querySelector('.v26-fullscreen');
    if(/\.m3u8($|\?)/i.test(src)&&!v.canPlayType('application/vnd.apple.mpegurl')){
      try{const mod=await import('https://cdn.jsdelivr.net/npm/hls.js@1/+esm');const Hls=mod.default;if(Hls.isSupported()){const h=new Hls({enableWorker:true,lowLatencyMode:true});h.loadSource(src);h.attachMedia(v);wrap._hls=h}else v.src=src}catch{v.src=src}
    } else v.src=src;
    play.onclick=()=>v.paused?v.play():v.pause();v.addEventListener('play',()=>play.textContent='❚❚');v.addEventListener('pause',()=>play.textContent='▶');
    v.addEventListener('timeupdate',()=>{if(v.duration)seek.value=String(v.currentTime/v.duration*100)});seek.oninput=()=>{if(v.duration)v.currentTime=(+seek.value/100)*v.duration};
    mute.onclick=()=>{v.muted=!v.muted;mute.textContent=v.muted?'🔇':'🔊'};full.onclick=()=>wrap.requestFullscreen?.();
  }
  window.SultanMediaPlayer={mount:mountPlayer};

  // Before/after range handling (works for dynamically inserted projects too).
  document.addEventListener('input',e=>{if(e.target.matches('.v26-compare input[type=range]'))e.target.closest('.v26-compare')?.style.setProperty('--split',`${e.target.value}%`)});

  async function loadSettings(){
    const sb=await getSB(); if(!sb)return null;
    try{const {data}=await sb.from('site_settings').select('value').eq('key','business').maybeSingle();return data?.value||null}catch{return null}
  }
  async function enhanceHero(){
    const frame=document.getElementById('heroMediaFrame'); if(!frame)return;
    const s=await loadSettings(); const src=s?.hero_video_url,poster=s?.hero_poster_url||s?.cover_url||'';
    if(!src)return;
    const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches,save=navigator.connection?.saveData,slow=/2g/.test(navigator.connection?.effectiveType||'');
    if(reduce||save||slow)return;
    const img=document.getElementById('heroPoster'); if(img&&poster)img.src=poster;
    const v=document.createElement('video');v.className='v26-hero-video';v.autoplay=true;v.muted=true;v.loop=true;v.playsInline=true;v.preload='metadata';if(poster)v.poster=poster;v.src=src;
    v.addEventListener('canplay',()=>{img?.setAttribute('hidden','');v.play().catch(()=>{})},{once:true});v.addEventListener('error',()=>v.remove(),{once:true});frame.append(v);
    const badge=document.createElement('span');badge.className='v26-hero-status';badge.textContent='CINEMATIC / LIVE';frame.append(badge);
  }

  async function loadMediaPlatform(){
    const sb=await getSB();if(!sb)return;
    let events=[],media=[];
    try{
      const [er,mr]=await Promise.all([
        sb.from('events').select('id,title,slug,event_type,event_date,city,venue,summary,is_featured,featured_order,project_details').eq('is_published',true).order('is_featured',{ascending:false}).order('featured_order',{ascending:true}).order('event_date',{ascending:false}).limit(30),
        sb.from('media').select('id,file_name,bucket_id,storage_path,public_url,mime_type,event_id,alt_text,caption,sort_order,is_cover,media_role,pair_key,poster_url,video_provider,video_uid,video_playback_url,duration_seconds').eq('visibility','public').order('sort_order').limit(160)
      ]);events=er.data||[];media=(mr.data||[]).map(x=>({...x,_url:publicUrl(sb,x)}));
    }catch{return}
    const eventById=new Map(events.map(e=>[e.id,e]));

    const showcase=document.getElementById('cmsLiveShowcase'),fallback=document.getElementById('cmsLiveShowcaseFallback');
    if(showcase){
      const cards=events.map(ev=>{const mm=media.filter(m=>m.event_id===ev.id),cover=mm.find(m=>m.media_role==='hero'&&(m.mime_type||'').startsWith('image/'))||mm.find(m=>m.is_cover&&(m.mime_type||'').startsWith('image/'))||mm.find(m=>(m.mime_type||'').startsWith('image/'));return cover?{ev,cover}:null}).filter(Boolean).slice(0,4);
      if(cards.length){showcase.hidden=false;fallback&&(fallback.hidden=true);showcase.innerHTML=cards.map(({ev,cover})=>`<a class="v26-showcase-card" href="/event?slug=${encodeURIComponent(ev.slug)}"><img src="${esc(cover._url)}" alt="${esc(cover.alt_text||ev.title)}" loading="lazy" decoding="async"><div class="v26-showcase-copy"><small>${esc(ev.event_type||'PROJECT')} · ${esc((ev.event_date||'').slice(0,4))}</small><h3>${esc(ev.title)}</h3></div></a>`).join('')}
    }

    const reels=document.getElementById('cmsReels');
    if(reels){const vids=media.filter(m=>m.video_playback_url||(m.mime_type||'').startsWith('video/')).filter(m=>['hero','reel','gallery'].includes(m.media_role||'gallery')).slice(0,6);reels.innerHTML='';for(const m of vids){const ev=eventById.get(m.event_id),card=document.createElement('article');card.className='v26-reel-card';card.innerHTML=`<div class="v26-reel-player"></div><h3>${esc(m.caption||ev?.title||'Sultan Film')}</h3><p>${esc([ev?.event_type,ev?.event_date].filter(Boolean).join(' · '))}</p>`;reels.append(card);await mountPlayer(card.querySelector('.v26-reel-player'),{src:m.video_playback_url||m._url,poster:m.poster_url||'',title:m.caption||ev?.title||'Sultan Film'})}}
  }

  enhanceHero();loadMediaPlatform();
})();
