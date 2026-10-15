const $$=(sel,root=document)=>[...root.querySelectorAll(sel)];
const esc=(s='')=>String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));

// Header + resilient reveal motion
const header=document.getElementById('siteHeader')||document.querySelector('header');
const syncHeader=()=>header?.classList.toggle('scrolled',window.scrollY>12);
syncHeader();window.addEventListener('scroll',syncHeader,{passive:true});

const revealEls=$$('.reveal');
if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window){
  revealEls.forEach(el=>el.classList.add('will-reveal'));
  const io=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('show');io.unobserve(e.target)}}),{threshold:.06,rootMargin:'0px 0px -20px'});
  requestAnimationFrame(()=>revealEls.forEach(el=>io.observe(el)));
}else{revealEls.forEach(el=>el.classList.add('show'))}

// Mobile navigation — accessible, scroll-safe, closes outside/Escape
const mobileToggle=document.getElementById('mobileToggle');
const menu=document.getElementById('menu');
function closeMenu(){menu?.classList.remove('mobile-open');mobileToggle?.setAttribute('aria-expanded','false');mobileToggle?.setAttribute('aria-label','فتح القائمة');document.body.classList.remove('menu-open')}
function openMenu(){menu?.classList.add('mobile-open');mobileToggle?.setAttribute('aria-expanded','true');mobileToggle?.setAttribute('aria-label','إغلاق القائمة');document.body.classList.add('menu-open')}
mobileToggle?.addEventListener('click',()=>menu?.classList.contains('mobile-open')?closeMenu():openMenu());
$$('#menu a').forEach(a=>a.addEventListener('click',closeMenu));
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenu()});
document.addEventListener('pointerdown',e=>{if(menu?.classList.contains('mobile-open')&&!menu.contains(e.target)&&!mobileToggle?.contains(e.target))closeMenu()});
window.addEventListener('resize',()=>{if(innerWidth>980)closeMenu()});

// Portfolio filters
$$('.filter-btn').forEach(btn=>btn.addEventListener('click',()=>{
  $$('.filter-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');
  const cat=btn.dataset.filter;
  $$('.portfolio-item').forEach(item=>item.hidden=!(cat==='all'||item.dataset.cat===cat));
}));

// FAQ accordion
$$('.faq-q').forEach(q=>q.addEventListener('click',()=>{
  const item=q.closest('.faq-item');
  const open=item.classList.toggle('open');
  q.setAttribute('aria-expanded',String(open));
}));

// Smart planning assistant
const planner=document.getElementById('plannerForm');
if(planner){planner.addEventListener('submit',e=>{
  e.preventDefault();
  const type=document.getElementById('pType')?.value||'';
  const size=document.getElementById('pSize')?.value||'';
  const duration=document.getElementById('pDuration')?.value||'';
  const split=document.getElementById('pSplit')?.value||'';
  const extras=document.getElementById('pExtras')?.value||'';
  const recommendation=[`لـ ${type} بحجم ${size} وتغطية ${duration}:`];
  recommendation.push(size==='كبير'||duration==='يوم كامل'?'يفضل توزيع التغطية على أكثر من نقطة حتى لا تضيع اللحظات الأساسية.':'يمكن بناء تغطية مركزة بفريق أخف بعد تحديد اللحظات الأساسية مسبقاً.');
  if(split==='نعم') recommendation.push('بما أن الرجال والنساء منفصلون، الأفضل تخطيط طاقمين منفصلين وتحديد حركة كل طاقم مسبقاً.');
  if(extras.includes('DJ')) recommendation.push('خدمة DJ تُنسق مع جدول المناسبة ومكان السماعات وطبيعة القاعة أو الساحة.');
  if(extras.includes('إعلان')) recommendation.push('للمحتوى الإعلاني نخصص لقطات عمودية قصيرة منفصلة عن فيلم المناسبة.');
  recommendation.push('هذه توصية تنظيمية أولية وليست سعراً أو تأكيد حجز؛ الترتيب النهائي يتم بعد مراجعة التاريخ والمكان والتفاصيل.');
  const box=document.getElementById('recommendation');
  if(box){box.innerHTML=`<h4>التوصية الأولية</h4><p>${recommendation.join(' ')}</p><button type="button" class="recommendation-reset" id="plannerReset">مسح التوصية</button>`;box.classList.add('show');document.getElementById('plannerReset')?.addEventListener('click',()=>{box.classList.remove('show');box.innerHTML='';planner.reset()})}
})}

// Legacy WhatsApp form, retained when present
const bookingForm=document.getElementById('bookingForm');
if(bookingForm){bookingForm.addEventListener('submit',async e=>{
  e.preventDefault();const val=id=>document.getElementById(id)?.value?.trim()||'غير محدد';
  const text=['طلب تغطية جديد - ستوديو وتسجيلات السلطان',`الاسم: ${val('bName')}`,`الهاتف: ${val('bPhone')}`,`نوع المناسبة: ${val('bType')}`,`التاريخ: ${val('bDate')}`,`المكان: ${val('bPlace')}`,`الخدمات المطلوبة: ${val('bServices')}`,`مدة التغطية: ${val('bDuration')}`,`عدد الكاميرات المتوقع/المطلوب: ${val('bCameras')}`,`تجهيزات أو ملاحظات خاصة: ${val('bNotes')}`].join('\n');
  try{await navigator.clipboard.writeText(text)}catch(_e){}
  window.open('https://wa.me/message/I4OXKEUV7DX6L1','_blank','noopener');
})}

// Archive filters
const archiveSearch=document.getElementById('archiveSearch'),archiveType=document.getElementById('archiveType'),archiveStatus=document.getElementById('archiveStatus');
function filterArchive(){
  if(!archiveSearch)return;
  const q=archiveSearch.value.trim().toLowerCase(),type=archiveType?.value||'الكل';
  const cards=$$('.archive-card[data-event-card="1"]');
  let visible=0;
  cards.forEach(card=>{const match=card.innerText.toLowerCase().includes(q)&&(type==='الكل'||card.dataset.type===type);card.hidden=!match;if(match)visible++});
  if(archiveStatus){
    if(!cards.length) archiveStatus.textContent='لا توجد مناسبات منشورة في الأرشيف حالياً.';
    else if(!visible) archiveStatus.textContent='لا توجد نتائج مطابقة للبحث أو التصنيف.';
    else archiveStatus.textContent=`يعرض ${visible} من ${cards.length} مناسبة منشورة.`;
  }
}
window.filterSultanArchive=filterArchive;
archiveSearch?.addEventListener('input',filterArchive);archiveType?.addEventListener('change',filterArchive);

// Supabase public client
let publicClientPromise=null;
async function getSupabasePublic(){
  if(publicClientPromise)return publicClientPromise;
  publicClientPromise=(async()=>{const cfg=window.SULTAN_CMS||{};if(!cfg.supabaseUrl||cfg.supabaseUrl.includes('REPLACE_'))return null;const mod=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');return mod.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey)})();
  return publicClientPromise;
}

// Turnstile V25 — explicit render, status, graceful fallback
let turnstileScriptPromise=null;
const turnstileTokens=new Map();
const turnstileWidgets=new Map();
function ensureTurnstile(){
  if(window.turnstile?.render)return Promise.resolve(window.turnstile);
  if(turnstileScriptPromise)return turnstileScriptPromise;
  turnstileScriptPromise=new Promise((resolve,reject)=>{
    const existing=document.querySelector('script[data-sultan-turnstile]');
    if(existing){existing.addEventListener('load',()=>resolve(window.turnstile),{once:true});existing.addEventListener('error',reject,{once:true});return}
    const sc=document.createElement('script');
    sc.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';sc.async=true;sc.defer=true;sc.dataset.sultanTurnstile='1';
    sc.onload=()=>window.turnstile?.render?resolve(window.turnstile):reject(new Error('turnstile_unavailable'));
    sc.onerror=()=>reject(new Error('turnstile_script_failed'));
    document.head.appendChild(sc);
  });
  return turnstileScriptPromise;
}
function turnstileFallback(target,message='تعذر تجهيز الحماية الآن. يمكنك المتابعة عبر واتساب.'){
  if(!target)return;target.dataset.turnstile='error';
  target.innerHTML=`<div class="turnstile-fallback"><span class="turnstile-status error">${esc(message)}</span><a href="https://wa.me/message/I4OXKEUV7DX6L1" target="_blank" rel="noopener">واتساب ↗</a></div>`;
}
async function loadTurnstile(targetId){
  const cfg=window.SULTAN_CMS||{},target=document.getElementById(targetId);
  if(!target)return;
  target.classList.add('turnstile-slot');
  if(!cfg.turnstileSiteKey||cfg.turnstileSiteKey.includes('REPLACE_')){turnstileFallback(target,'حماية النموذج غير مهيأة بعد.');return}
  target.innerHTML='<span class="turnstile-status">جاري تجهيز الحماية…</span>';
  try{
    const api=await ensureTurnstile();
    target.replaceChildren();
    const mount=document.createElement('div');target.appendChild(mount);
    const widgetId=api.render(mount,{
      sitekey:cfg.turnstileSiteKey,theme:'dark',
      callback:(token)=>{turnstileTokens.set(targetId,token);target.dataset.turnstile='ready'},
      'expired-callback':()=>{turnstileTokens.delete(targetId);target.dataset.turnstile='expired'},
      'error-callback':()=>{turnstileTokens.delete(targetId);turnstileFallback(target,'تعذر التحقق من الحماية على هذا النطاق.')}
    });
    turnstileWidgets.set(targetId,widgetId);
  }catch(_e){turnstileFallback(target)}
}
['bookingTurnstile','complaintTurnstile','trackBookingTurnstile','trackComplaintTurnstile','availabilityTurnstile'].forEach(loadTurnstile);
const turnstileToken=id=>turnstileTokens.get(id)||document.querySelector(`#${id} input[name="cf-turnstile-response"]`)?.value||null;
function requireTurnstile(id,msg){
  const mount=document.getElementById(id);if(!mount)return true;
  if(turnstileToken(id))return true;
  if(msg)msg.innerHTML='أكمل تحقق الحماية أولاً. إذا لم يظهر التحقق، استخدم <a href="https://wa.me/message/I4OXKEUV7DX6L1" target="_blank" rel="noopener">واتساب</a>.';
  mount.scrollIntoView({behavior:'smooth',block:'center'});return false;
}
function resetTurnstile(id){const wid=turnstileWidgets.get(id);if(wid!==undefined&&window.turnstile?.reset){try{window.turnstile.reset(wid)}catch(_e){}}turnstileTokens.delete(id)}

// Persistent booking form
const persistentBooking=document.getElementById('persistentBookingForm');
if(persistentBooking){persistentBooking.addEventListener('submit',async e=>{
  e.preventDefault();const sb=await getSupabasePublic(),get=id=>document.getElementById(id)?.value?.trim()||'',msg=document.getElementById('bookingResult');
  if(!sb){if(msg)msg.textContent='قاعدة البيانات غير مربوطة بعد. استخدم واتساب حالياً.';return}
  if(!requireTurnstile('bookingTurnstile',msg))return;
  const qs=new URLSearchParams(location.search);
  const payload={customer_name:get('pbName'),phone:get('pbPhone'),email:get('pbEmail'),event_type:get('pbType'),event_date:get('pbDate'),city:get('pbCity'),venue:get('pbVenue'),services_requested:get('pbServices'),duration:get('pbDuration'),cameras:get('pbCameras'),women_team_required:document.getElementById('pbWomen')?.checked||false,publication_permission:get('pbPrivacy')||'partial',notes:get('pbNotes'),referrer:document.referrer||null,utm_source:qs.get('utm_source'),utm_medium:qs.get('utm_medium'),utm_campaign:qs.get('utm_campaign'),turnstileToken:turnstileToken('bookingTurnstile')};
  if(msg)msg.textContent='جاري إرسال الطلب...';const {data,error}=await sb.functions.invoke('submit-booking',{body:payload});
  if(msg)msg.innerHTML=error?'تعذر إرسال الطلب. حاول مرة أخرى أو استخدم واتساب.':`تم استلام طلبك. رقم المتابعة: <b>${esc(data.reference_no)}</b>. هذا ليس تأكيد حجز بعد.`;if(!error){persistentBooking.reset();resetTurnstile('bookingTurnstile')};
})}

// Complaints
const complaintForm=document.getElementById('complaintForm');
if(complaintForm){complaintForm.addEventListener('submit',async e=>{
  e.preventDefault();const sb=await getSupabasePublic(),get=id=>document.getElementById(id)?.value?.trim()||'',msg=document.getElementById('complaintResult');if(!sb){if(msg)msg.textContent='النظام غير مربوط بعد. استخدم واتساب حالياً.';return}
  if(!requireTurnstile('complaintTurnstile',msg))return;
  const payload={customer_name:get('cName'),phone:get('cPhone'),email:get('cEmail'),complaint_type:get('cType'),subject:get('cSubject'),details:get('cDetails'),priority:get('cPriority')||'normal',turnstileToken:turnstileToken('complaintTurnstile')};if(msg)msg.textContent='جاري الإرسال...';const {data,error}=await sb.functions.invoke('submit-complaint',{body:payload});if(msg)msg.innerHTML=error?'تعذر إرسال الطلب. حاول لاحقاً.':`تم الاستلام. رقم المتابعة: <b>${esc(data.tracking_code)}</b>`;if(!error){complaintForm.reset();resetTurnstile('complaintTurnstile')};
})}

const stageNames={new:'طلب جديد',contacted:'تم التواصل',details_complete:'التفاصيل مكتملة',proposal_sent:'تم إرسال العرض/الاتفاق',waiting_deposit:'بانتظار العربون',confirmed:'الحجز مؤكد',preparing:'جاري تجهيز الفريق',event_today:'المناسبة اليوم',captured:'تم التصوير',culling:'فرز المواد',editing:'المونتاج',review:'المراجعة',revision:'تعديل',ready_delivery:'جاهز للتسليم',delivered:'تم التسليم',closed:'مغلق',cancelled:'ملغي'};
const complaintNames={new:'جديدة',reviewing:'قيد المراجعة',contacted:'تم التواصل',waiting_customer:'بانتظار رد العميل',resolving:'جاري الحل',resolved:'تم الحل',closed:'مغلقة'};

document.getElementById('trackBookingForm')?.addEventListener('submit',async e=>{e.preventDefault();const sb=await getSupabasePublic(),box=document.getElementById('trackBookingResult');if(!sb){box.textContent='النظام غير مربوط بعد.';return}if(!requireTurnstile('trackBookingTurnstile',box))return;box.textContent='جاري البحث...';const {data,error}=await sb.functions.invoke('track-booking',{body:{reference_no:document.getElementById('tbCode').value.trim(),phone:document.getElementById('tbPhone').value.trim(),turnstileToken:turnstileToken('trackBookingTurnstile')}});if(error||!data?.booking){box.textContent='لم نجد طلباً مطابقاً لهذه البيانات.';resetTurnstile('trackBookingTurnstile');return}const b=data.booking;box.innerHTML=`<b>${esc(b.reference_no)}</b><br>الحالة: <b>${esc(stageNames[b.stage]||b.stage)}</b><br>${esc([b.event_type,b.event_date,b.venue,b.city].filter(Boolean).join(' — '))}`;resetTurnstile('trackBookingTurnstile')});

document.getElementById('trackComplaintForm')?.addEventListener('submit',async e=>{e.preventDefault();const sb=await getSupabasePublic(),box=document.getElementById('trackComplaintResult');if(!sb){box.textContent='النظام غير مربوط بعد.';return}if(!requireTurnstile('trackComplaintTurnstile',box))return;box.textContent='جاري البحث...';const {data,error}=await sb.functions.invoke('track-complaint',{body:{tracking_code:document.getElementById('tcCode').value.trim(),phone:document.getElementById('tcPhone').value.trim(),turnstileToken:turnstileToken('trackComplaintTurnstile')}});if(error||!data?.complaint){box.textContent='لم نجد طلباً مطابقاً لهذه البيانات.';resetTurnstile('trackComplaintTurnstile');return}const c=data.complaint,msg=(c.messages||[]).map(x=>`<div style="padding:8px 0;border-top:1px solid rgba(255,255,255,.08)"><b>${esc(x.author_name||'الاستوديو')}</b>: ${esc(x.body)}</div>`).join('');box.innerHTML=`<b>${esc(c.tracking_code)}</b><br>الحالة: <b>${esc(complaintNames[c.status]||c.status)}</b><br>الأولوية: ${esc(c.priority)}<br>${msg}`;resetTurnstile('trackComplaintTurnstile')});

document.getElementById('availabilityForm')?.addEventListener('submit',async e=>{e.preventDefault();const sb=await getSupabasePublic(),box=document.getElementById('availabilityResult'),date=document.getElementById('availabilityDate').value;if(!sb){box.textContent='النظام غير مربوط بعد.';return}if(!requireTurnstile('availabilityTurnstile',box))return;box.textContent='جاري الفحص...';const {data,error}=await sb.functions.invoke('check-date',{body:{date,turnstileToken:turnstileToken('availabilityTurnstile')}});if(error||!data?.ok){box.textContent='تعذر الفحص الآن. يمكنك إرسال طلب التغطية مباشرة.';resetTurnstile('availabilityTurnstile');return}box.innerHTML=data.has_existing_commitments?'<b>يوجد التزام مسجل بهذا اليوم.</b> هذا لا يعني أن اليوم مغلق؛ أرسل الطلب لنراجع قدرة الفريق والتوقيت.':'<b>لا يظهر تعارض مؤكد حالياً.</b> النتيجة أولية فقط، والموعد لا يصبح محجوزاً إلا بعد التأكيد.';resetTurnstile('availabilityTurnstile')});

// V24 progressive enhancement: reading progress only; no backend behavior changed.
(()=>{
  const bar=document.querySelector('.v24-progress span');
  if(!bar) return;
  const paint=()=>{
    const doc=document.documentElement;
    const max=Math.max(1,doc.scrollHeight-innerHeight);
    const value=Math.min(1,Math.max(0,scrollY/max));
    bar.style.width=`${(value*100).toFixed(2)}%`;
  };
  paint();
  addEventListener('scroll',paint,{passive:true});
  addEventListener('resize',paint,{passive:true});
})();
