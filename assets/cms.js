(async function(){
  const cfg=window.SULTAN_CMS||{};
  const esc=(s='')=>String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const show=el=>{if(el){el.hidden=false;el.classList.add('show')}};
  const hide=el=>{if(el)el.hidden=true};
  if(!cfg.supabaseUrl||cfg.supabaseUrl.includes('REPLACE_'))return;

  let sb;
  try{
    const mod=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    sb=mod.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey);
  }catch(_e){return;}

  try{
    const {data:settings}=await sb.from('site_settings').select('key,value').eq('key','business').maybeSingle();
    if(settings?.value){
      const s=settings.value;
      document.querySelectorAll('[data-business-name]').forEach(x=>x.textContent=s.name||x.textContent);
      document.querySelectorAll('[data-tagline]').forEach(x=>x.textContent=s.tagline||x.textContent);
      const configured={
        'https://www.facebook.com/Sultan.Rec0rds2':s.facebook,
        'https://www.youtube.com/@Sultan-Records-Studio.1':s.youtube,
        'https://wa.me/message/I4OXKEUV7DX6L1':s.whatsapp,
        'https://share.google/LvNMbL01C994fa5j6':s.google,
        'tel:+970598677477':s.phone?`tel:${String(s.phone).replace(/\s+/g,'')}`:null
      };
      document.querySelectorAll('a[href]').forEach(a=>{const raw=a.getAttribute('href');if(configured[raw])a.href=configured[raw]});
      if(s.logo_url)document.querySelectorAll('.brand img,.footer-brand img,.footer-identity img,.identity-logo img,.stage-logo,.v24-brand img,.v24-footer-brand img').forEach(img=>img.src=s.logo_url);
      if(s.google_analytics_id&&/^G-[A-Z0-9]+$/i.test(s.google_analytics_id)){
        const gs=document.createElement('script');gs.async=true;gs.src=`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(s.google_analytics_id)}`;document.head.appendChild(gs);
        window.dataLayer=window.dataLayer||[];window.gtag=function(){dataLayer.push(arguments)};gtag('js',new Date());gtag('config',s.google_analytics_id,{anonymize_ip:true});
      }
      if(s.cloudflare_analytics_token&&/^[A-Za-z0-9_-]{10,}$/.test(s.cloudflare_analytics_token)){
        const cs=document.createElement('script');cs.defer=true;cs.src='https://static.cloudflareinsights.com/beacon.min.js';cs.setAttribute('data-cf-beacon',JSON.stringify({token:s.cloudflare_analytics_token}));document.head.appendChild(cs);
      }
    }
  }catch(_e){}

  // Services — only rows allowed by RLS/publication status.
  const servicesMount=document.getElementById('cmsServices');
  if(servicesMount){
    try{
      const {data}=await sb.from('services').select('id,name,category,summary,icon,sort_order').eq('is_published',true).order('sort_order');
      servicesMount.innerHTML=(data||[]).map((x,i)=>`<article class="service-card card reveal show"><div class="service-code">${String(i+1).padStart(2,'0')} / ${esc((x.category||'SERVICE').toUpperCase())}</div><div class="service-icon">${esc(x.icon||'◇')}</div><h3>${esc(x.name)}</h3><p>${esc(x.summary||'')}</p></article>`).join('');
    }catch(_e){}
  }

  // Offers hide completely when none are active.
  const offersMount=document.getElementById('cmsOffers');
  if(offersMount){
    try{
      const {data}=await sb.from('offers').select('id,title,summary,badge,sort_order').eq('is_published',true).order('sort_order').limit(6);
      if(data?.length)offersMount.innerHTML=data.map(x=>`<article class="service-card card reveal show"><div class="service-code">${esc(x.badge||'OFFER')}</div><div class="service-icon">✦</div><h3>${esc(x.title)}</h3><p>${esc(x.summary||'')}</p></article>`).join('');
      else hide(offersMount.closest('section'));
    }catch(_e){hide(offersMount.closest('section'))}
  }

  // Public events. RLS additionally enforces public privacy + publication permission.
  const eventsMount=document.getElementById('cmsEvents');
  let publicEvents=[];
  try{
    const {data}=await sb.from('events').select('id,title,slug,event_type,event_date,city,venue,summary,is_featured').eq('is_published',true).order('event_date',{ascending:false}).limit(100);
    publicEvents=data||[];
  }catch(_e){}
  if(eventsMount){
    if(publicEvents.length){
      eventsMount.innerHTML=publicEvents.map(x=>`<a class="archive-card card reveal show" data-event-card="1" data-type="${esc(x.event_type||'')}" href="/event?slug=${encodeURIComponent(x.slug)}"><div class="meta"><span>${esc(x.event_type||'مناسبة')}</span><span>${esc(x.city||'')}</span><span>${esc((x.event_date||'').slice(0,4))}</span></div><h3>${esc(x.title)}</h3><p>${esc(x.summary||[x.venue,x.city].filter(Boolean).join(' — '))}</p></a>`).join('');
    }else{
      eventsMount.innerHTML='<article class="archive-card card show archive-empty"><div class="meta"><span>ARCHIVE READY</span></div><h3>لا توجد مناسبات منشورة للعامة حالياً.</h3><p>عندما تنشر مناسبة من StudioOS وتكون الخصوصية عامة وإذن النشر مفعلاً، ستظهر هنا تلقائياً.</p></article>';
    }
    window.filterSultanArchive?.();
  }

  const eventMap=new Map(publicEvents.map(x=>[x.id,x]));
  function mediaUrl(x){
    if(/^https?:\/\//i.test(x.public_url||''))return x.public_url;
    if(x.bucket_id&&x.storage_path){try{return sb.storage.from(x.bucket_id).getPublicUrl(x.storage_path).data.publicUrl||''}catch(_e){}}
    return '';
  }
  function categoryFor(media,event){
    if((media.mime_type||'').startsWith('video/'))return 'video';
    const t=(event?.event_type||'').toLowerCase();
    if(/اعلان|إعلان|commercial|promo/.test(t))return 'commercial';
    if(/dj|ديجي|صوت/.test(t))return 'dj';
    if(/زفاف|عرس|wedding/.test(t))return 'weddings';
    return 'events';
  }

  // Correct V25 media schema: visibility/public_url/storage_path/alt_text/caption.
  let publicMedia=[];
  try{
    const {data}=await sb.from('media').select('id,file_name,bucket_id,storage_path,public_url,mime_type,visibility,event_id,alt_text,caption,sort_order,is_cover').eq('visibility','public').order('sort_order').limit(80);
    publicMedia=(data||[]).map(x=>({...x,_url:mediaUrl(x)})).filter(x=>x._url);
  }catch(_e){}

  const homeMedia=document.getElementById('cmsHomeMedia');
  const homeFallback=document.getElementById('cmsHomeMediaFallback');
  if(homeMedia){
    const images=publicMedia.filter(x=>(x.mime_type||'').startsWith('image/')).slice(0,6);
    if(images.length){
      show(homeMedia);hide(homeFallback);
      homeMedia.innerHTML=images.map((x,i)=>{const ev=eventMap.get(x.event_id);return `<a class="home-media-item home-media-${i+1}" href="${ev?.slug?`/event?slug=${encodeURIComponent(ev.slug)}`:'/portfolio'}" aria-label="${esc(x.alt_text||x.caption||ev?.title||'من أعمال الاستوديو')}"><img src="${esc(x._url)}" alt="${esc(x.alt_text||x.caption||ev?.title||'من أعمال الاستوديو')}" loading="lazy" decoding="async"></a>`}).join('');
    }else{hide(homeMedia);show(homeFallback)}
  }

  const portfolio=document.getElementById('cmsPortfolio');
  const portfolioFallback=document.getElementById('cmsPortfolioFallback');
  if(portfolio){
    const images=publicMedia.filter(x=>(x.mime_type||'').startsWith('image/')).slice(0,24);
    if(images.length){
      hide(portfolioFallback);
      portfolio.innerHTML=images.map((x,i)=>{const ev=eventMap.get(x.event_id),cat=categoryFor(x,ev),title=x.caption||ev?.title||'من أعمال الاستوديو';return `<a class="v25-project portfolio-item" data-cat="${esc(cat)}" href="${ev?.slug?`/event?slug=${encodeURIComponent(ev.slug)}`:'#'}"><img src="${esc(x._url)}" alt="${esc(x.alt_text||title)}" loading="lazy" decoding="async"><div class="v25-project-copy"><small>${esc(ev?.event_type||cat.toUpperCase())}</small><h3>${esc(title)}</h3></div></a>`}).join('');
    }else{show(portfolioFallback)}
  }

  const reviewsMount=document.getElementById('cmsReviews');
  if(reviewsMount){
    try{
      const {data}=await sb.from('reviews').select('rating,review_text,reviewer_name').eq('is_approved',true).order('published_at',{ascending:false}).limit(6);
      if(data?.length)reviewsMount.innerHTML=data.map(x=>`<article class="guide-card card reveal show"><div class="gold" aria-label="${Number(x.rating||5)} من 5">${'★'.repeat(Math.max(1,Math.min(5,Number(x.rating||5))))}</div><h3>${esc(x.reviewer_name||'عميل')}</h3><p class="muted">${esc(x.review_text||'')}</p></article>`).join('');
      else hide(reviewsMount.closest('section'));
    }catch(_e){hide(reviewsMount.closest('section'))}
  }
})();
