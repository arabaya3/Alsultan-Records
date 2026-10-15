
let sb=null,currentUser=null,currentProfile=null,mfaFactorId=null;
const cfg=window.SULTAN_CMS||{}, $=id=>document.getElementById(id), $$=s=>[...document.querySelectorAll(s)];
const esc=(s="")=>String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));
const stageLabels={new:"جديد",contacted:"تم التواصل",details_complete:"التفاصيل مكتملة",proposal_sent:"عرض/اتفاق",waiting_deposit:"بانتظار العربون",confirmed:"مؤكد",preparing:"تجهيز الفريق",event_today:"المناسبة اليوم",captured:"تم التصوير",culling:"فرز",editing:"مونتاج",review:"مراجعة",revision:"تعديل",ready_delivery:"جاهز للتسليم",delivered:"تم التسليم",closed:"مغلق",cancelled:"ملغي"};
const complaintLabels={new:"جديدة",reviewing:"مراجعة",contacted:"تم التواصل",waiting_customer:"بانتظار العميل",resolving:"جاري الحل",resolved:"تم الحل",closed:"مغلقة"};
const money=n=>Number(n||0).toLocaleString("ar-EG",{maximumFractionDigits:2})+" ₪";

async function init(){
  if(!cfg.supabaseUrl||cfg.supabaseUrl.includes("REPLACE_")){
    $("loginMsg").textContent="الكود جاهز. اربط Supabase أولاً لتشغيل الإدارة.";
    return;
  }
  const {createClient}=await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
  sb=createClient(cfg.supabaseUrl,cfg.supabaseAnonKey);
  const {data:{session}}=await sb.auth.getSession();
  if(session) await afterAuth(session.user);
  sb.auth.onAuthStateChange(async(_e,s)=>{if(s)await afterAuth(s.user);else showLogin();});
  startIdleLogout();
}
function showLogin(){$("loginScreen").style.display="grid";$("mfaScreen").style.display="none";$("adminShell").style.display="none";}
async function login(e){e.preventDefault();$("loginMsg").textContent="جاري الدخول...";const {error}=await sb.auth.signInWithPassword({email:$("email").value.trim(),password:$("password").value});$("loginMsg").textContent=error?error.message:"";}
async function sendMagicLink(){
  const email=$("email").value.trim();
  if(!email){$("loginMsg").textContent="اكتب البريد الإلكتروني أولاً.";return;}
  $("loginMsg").textContent="جاري إرسال رابط الدخول...";
  const redirectTo=new URL("/admin.html",window.location.origin).href;
  const {error}=await sb.auth.signInWithOtp({email,options:{shouldCreateUser:false,emailRedirectTo:redirectTo}});
  $("loginMsg").textContent=error?error.message:"تم إرسال رابط دخول آمن إلى بريدك. افتحه من نفس المتصفح.";
}
async function logout(){await sb.auth.signOut();}
async function afterAuth(user){
  currentUser=user;
  let {data:p,error}=await sb.from("profiles").select("*").eq("id",user.id).single();

  // First-run bootstrap: the very first authenticated profile can promote only itself.
  // The database function enforces: exactly one profile, no active admin, and current user only.
  if(!error && p && p.role==="customer" && !p.is_active){
    const boot=await sb.rpc("bootstrap_initial_owner");
    if(!boot.error){
      const refreshed=await sb.from("profiles").select("*").eq("id",user.id).single();
      p=refreshed.data; error=refreshed.error;
    }
  }

  if(error||!p?.is_active||!["super_admin","admin","staff"].includes(p.role)){
    $("loginMsg").textContent="هذا الحساب غير مخول للإدارة.";
    await sb.auth.signOut();return;
  }
  currentProfile=p;
  if(p.mfa_required){
    const {data:a}=await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if(a?.currentLevel!=="aal2"){await showMfa();return;}
  }
  await enterAdmin();
}
async function showMfa(){
  $("loginScreen").style.display="none";$("adminShell").style.display="none";$("mfaScreen").style.display="grid";
  const {data:list}=await sb.auth.mfa.listFactors();
  const verified=list?.totp?.find(x=>x.status==="verified");
  if(verified){mfaFactorId=verified.id;$("mfaText").textContent="أدخل رمز تطبيق المصادقة.";return;}
  const {data,error}=await sb.auth.mfa.enroll({factorType:"totp",friendlyName:"Sultan StudioOS"});
  if(error){$("mfaMsg").textContent=error.message;return;}
  mfaFactorId=data.id;$("mfaText").textContent="امسح QR بتطبيق المصادقة ثم أدخل الرمز.";
  $("mfaQr").innerHTML=`<img style="max-width:220px;margin:12px auto" src="${data.totp.qr_code}" alt="MFA QR"><p class="admin-muted">المفتاح: ${esc(data.totp.secret)}</p>`;
}
async function verifyMfa(){
  const code=$("mfaCode").value.trim();if(!code)return;
  const {data:c,error:ce}=await sb.auth.mfa.challenge({factorId:mfaFactorId});
  if(ce){$("mfaMsg").textContent=ce.message;return;}
  const {error}=await sb.auth.mfa.verify({factorId:mfaFactorId,challengeId:c.id,code});
  if(error){$("mfaMsg").textContent=error.message;return;}
  await enterAdmin();
}
async function enterAdmin(){
  $("loginScreen").style.display="none";$("mfaScreen").style.display="none";$("adminShell").style.display="grid";
  $("adminName").textContent=currentProfile.full_name||currentUser.email;$("adminRole").textContent=currentProfile.role;
  enforceRole();await loadAll();
}
function enforceRole(){$$("[data-role]").forEach(el=>el.style.display=el.dataset.role.split(",").includes(currentProfile.role)?"":"none");}
function openView(id,btn){$$(".admin-view").forEach(v=>v.classList.remove("active"));$(id).classList.add("active");$$(".admin-nav button").forEach(b=>b.classList.remove("active"));btn?.classList.add("active");}
function startIdleLogout(){let t;const reset=()=>{clearTimeout(t);t=setTimeout(()=>{if(sb)sb.auth.signOut();},30*60*1000)};["click","keydown","mousemove","touchstart"].forEach(e=>document.addEventListener(e,reset,{passive:true}));reset();}
async function audit(action,type,id=null,details={}){try{await sb.from("audit_logs").insert({action,entity_type:type,entity_id:id,details})}catch(e){}}
async function count(table,filters=[]){let q=sb.from(table).select("*",{count:"exact",head:true});for(const [k,v] of filters)q=q.eq(k,v);const {count}=await q;return count||0;}

async function loadDashboard(){
  const [c,b,e,cmp]=await Promise.all([count("customers"),count("bookings"),count("events"),count("complaints",[["status","new"]])]);
  $("mCustomers").textContent=c;$("mBookings").textContent=b;$("mEvents").textContent=e;$("mComplaints").textContent=cmp;
  $("pipeline").innerHTML=Object.entries(stageLabels).map(([k,v])=>`<span class="stage-chip">${v}</span>`).join("");
  const today=new Date().toISOString().slice(0,10);
  const {data:due}=await sb.from("deliverables").select("title,due_at,status").neq("status","delivered").lte("due_at",new Date(Date.now()+3*864e5).toISOString()).order("due_at").limit(10);
  const {data:upcoming}=await sb.from("bookings").select("reference_no,customer_name,event_type,event_date,stage").gte("event_date",today).in("stage",["confirmed","preparing","event_today"]).order("event_date").limit(10);
  const alerts=[];
  (upcoming||[]).forEach(x=>alerts.push(`مناسبة قريبة: ${x.event_date} — ${x.customer_name} (${x.event_type})`));
  (due||[]).forEach(x=>alerts.push(`تسليم قريب: ${x.title} — ${x.due_at?.slice(0,10)}`));
  $("dashboardAlerts").innerHTML=alerts.length?alerts.map(x=>`<div>• ${esc(x)}</div>`).join(""):"لا توجد تنبيهات عاجلة.";
}

async function saveCustomer(e){
  e.preventDefault();
  const id=$("customerId").value||null,p={full_name:$("customerName").value.trim(),phone:$("customerPhone").value.trim()||null,email:$("customerEmail").value.trim()||null,city:$("customerCity").value.trim()||null,notes:$("customerNotes").value.trim()||null};
  const r=id?await sb.from("customers").update(p).eq("id",id).select().single():await sb.from("customers").insert(p).select().single();
  if(r.error)return alert(r.error.message);
  await audit(id?"update":"create","customer",r.data.id,p);e.target.reset();$("customerId").value="";
  await loadCustomers();await fillSelectors();await loadDashboard();
}
async function loadCustomers(){
  const {data}=await sb.from("customers").select("*").order("created_at",{ascending:false}).limit(500);
  $("customersRows").innerHTML=(data||[]).map(x=>`<tr><td>${esc(x.full_name)}</td><td>${esc(x.phone||"")}</td><td>${esc(x.email||"")}</td><td>${esc(x.city||"")}</td><td><button class="admin-btn" onclick='editCustomer(${JSON.stringify(x).replace(/'/g,"&#39;")})'>تعديل</button></td></tr>`).join("");
}
function editCustomer(x){$("customerId").value=x.id;$("customerName").value=x.full_name||"";$("customerPhone").value=x.phone||"";$("customerEmail").value=x.email||"";$("customerCity").value=x.city||"";$("customerNotes").value=x.notes||"";}

async function loadBookings(){
  const {data}=await sb.from("bookings").select("*").order("created_at",{ascending:false}).limit(500);
  $("bookingsRows").innerHTML=(data||[]).map(x=>`<tr><td>${esc(x.reference_no||"")}</td><td>${esc(x.customer_name)}</td><td>${esc(x.event_type||"")}</td><td>${esc(x.event_date||"")}</td><td><select onchange="updateBookingStage('${x.id}',this.value)">${Object.entries(stageLabels).map(([k,v])=>`<option value="${k}" ${x.stage===k?"selected":""}>${v}</option>`).join("")}</select></td><td><button class="admin-btn" onclick="createEventFromBooking('${x.id}')">تحويل لمناسبة</button> ${x.publication_permission==="private"?"🔒":""}</td></tr>`).join("");
}
async function updateBookingStage(id,stage){
  if(stage==="confirmed"){
    const {data:b}=await sb.from("bookings").select("event_date,start_at,end_at").eq("id",id).single();
    if(b?.event_date){
      const {data:c}=await sb.from("bookings").select("id,reference_no,customer_name").eq("event_date",b.event_date).eq("stage","confirmed").neq("id",id);
      if(c?.length&&!confirm(`يوجد ${c.length} حجز مؤكد بنفس التاريخ. تأكيد رغم ذلك؟`)){await loadBookings();return;}
    }
  }
  const {error}=await sb.from("bookings").update({stage}).eq("id",id);
  if(error)return alert(error.message);
  await audit("stage_update","booking",id,{stage});await loadDashboard();
}
async function createEventFromBooking(id){
  const {data:b,error:be}=await sb.from("bookings").select("*").eq("id",id).single();
  if(be||!b)return alert(be?.message||"تعذر قراءة الحجز.");
  const {data:existing,error:xe}=await sb.from("events").select("id,title").eq("booking_id",id).maybeSingle();
  if(xe)return alert(xe.message);
  if(existing)return alert(`هذا الحجز مرتبط مسبقاً بالمناسبة: ${existing.title||"بدون عنوان"}`);
  const ref=String(b.reference_no||id.slice(0,8)).toLowerCase().replace(/[^a-z0-9-]+/g,"-").replace(/^-+|-+$/g,"")||id.slice(0,8);
  const payload={
    booking_id:b.id,
    customer_id:b.customer_id||null,
    title:`${b.event_type||"مناسبة"} — ${b.customer_name}`,
    slug:`booking-${ref}-${Date.now().toString(36)}`,
    event_type:b.event_type||null,
    event_date:b.event_date||null,
    start_at:b.start_at||null,
    end_at:b.end_at||null,
    city:b.city||null,
    venue:b.venue||null,
    privacy_level:"private",
    publication_permission:false,
    is_featured:false,
    is_published:false,
    created_by:currentUser.id,
    updated_by:currentUser.id
  };
  const {data,error}=await sb.from("events").insert(payload).select().single();
  if(error)return alert(error.message);
  await audit("create_from_booking","event",data.id,{booking_id:id});
  alert("تم إنشاء المناسبة كمسودة خاصة. راجع الخصوصية وموافقة النشر قبل نشرها للعامة.");
  await Promise.all([loadEvents(),loadBookings(),loadDashboard()]);
  await fillSelectors();
}

async function loadCalendar(){
  if(!$("calendarRows"))return;
  const from=$("calFrom")?.value||new Date().toISOString().slice(0,10),to=$("calTo")?.value||new Date(Date.now()+60*864e5).toISOString().slice(0,10);
  if($("calFrom")&&!$("calFrom").value)$("calFrom").value=from;if($("calTo")&&!$("calTo").value)$("calTo").value=to;
  const {data}=await sb.from("bookings").select("id,reference_no,customer_name,event_type,event_date,venue,city,stage").gte("event_date",from).lte("event_date",to).order("event_date");
  const counts={};(data||[]).filter(x=>x.stage==="confirmed").forEach(x=>counts[x.event_date]=(counts[x.event_date]||0)+1);
  $("calendarRows").innerHTML=(data||[]).map(x=>`<tr><td>${x.event_date||""}</td><td>${esc(x.customer_name)} — ${esc(x.event_type||"")}</td><td>${esc([x.venue,x.city].filter(Boolean).join(" / "))}</td><td>${stageLabels[x.stage]||x.stage}</td><td>${x.stage==="confirmed"&&counts[x.event_date]>1?`⚠ ${counts[x.event_date]} حجوزات مؤكدة`:""}</td></tr>`).join("");
}

async function saveEvent(e){
  e.preventDefault();
  const id=$("eventId").value||null;
  const lines=id=>($(id)?.value||"").split(/\n+/).map(x=>x.trim()).filter(Boolean);
  const project_details={highlight:$("eventHighlight")?.value.trim()||null,services:lines("eventServicesUsed"),coverage_points:lines("eventCoveragePoints"),deliverables:lines("eventDeliverablesPublic"),production_note:$("eventProductionNote")?.value.trim()||null,gear_note:$("eventGearNote")?.value.trim()||null};
  const p={title:$("eventTitle").value.trim(),slug:$("eventSlug").value.trim(),event_type:$("eventType").value,event_date:$("eventDate").value||null,city:$("eventCity").value.trim()||null,venue:$("eventVenue").value.trim()||null,privacy_level:$("eventPrivacy").value,publication_permission:$("eventPermission").checked,summary:$("eventSummary").value.trim()||null,description:$("eventDescription").value.trim()||null,youtube_url:$("eventYoutube").value.trim()||null,project_details,seo_title:$("eventSeoTitle")?.value.trim()||null,seo_description:$("eventSeoDescription")?.value.trim()||null,featured_order:+($("eventFeaturedOrder")?.value||0),is_featured:$("eventFeatured").checked,is_published:$("eventPublished").checked};
  if(p.is_published&&(!p.publication_permission||p.privacy_level!=="public")){if(!confirm("المناسبة ليست عامة مع موافقة نشر. قد لا تظهر للزوار. متابعة؟"))return;}
  const r=id?await sb.from("events").update(p).eq("id",id).select().single():await sb.from("events").insert(p).select().single();
  if(r.error)return alert(r.error.message);
  await audit(id?"update":"create","event",r.data.id,p);e.target.reset();$("eventId").value="";
  await loadEvents();await fillSelectors();await loadDashboard();
}
async function loadEvents(){
  const {data}=await sb.from("events").select("*").order("event_date",{ascending:false});
  $("eventsRows").innerHTML=(data||[]).map(x=>`<tr><td>${esc(x.title)}</td><td>${esc(x.event_type||"")}</td><td>${esc(x.event_date||"")}</td><td>${esc(x.privacy_level)}</td><td>${x.is_published?"منشورة":"مخفية"}</td><td><button class="admin-btn" onclick='editEvent(${JSON.stringify(x).replace(/'/g,"&#39;")})'>تعديل</button></td></tr>`).join("");
}
function editEvent(x){const pd=x.project_details||{};$("eventId").value=x.id;$("eventTitle").value=x.title||"";$("eventSlug").value=x.slug||"";$("eventType").value=x.event_type||"زفاف";$("eventDate").value=x.event_date||"";$("eventCity").value=x.city||"";$("eventVenue").value=x.venue||"";$("eventPrivacy").value=x.privacy_level||"private";$("eventPermission").checked=!!x.publication_permission;$("eventSummary").value=x.summary||"";$("eventDescription").value=x.description||"";$("eventYoutube").value=x.youtube_url||"";if($("eventHighlight"))$("eventHighlight").value=pd.highlight||"";if($("eventServicesUsed"))$("eventServicesUsed").value=(pd.services||[]).join("\n");if($("eventCoveragePoints"))$("eventCoveragePoints").value=(pd.coverage_points||[]).join("\n");if($("eventDeliverablesPublic"))$("eventDeliverablesPublic").value=(pd.deliverables||[]).join("\n");if($("eventProductionNote"))$("eventProductionNote").value=pd.production_note||"";if($("eventGearNote"))$("eventGearNote").value=pd.gear_note||"";if($("eventFeaturedOrder"))$("eventFeaturedOrder").value=x.featured_order||0;if($("eventSeoTitle"))$("eventSeoTitle").value=x.seo_title||"";if($("eventSeoDescription"))$("eventSeoDescription").value=x.seo_description||"";$("eventFeatured").checked=!!x.is_featured;$("eventPublished").checked=!!x.is_published;}

async function deleteMedia(id,bucket,path){
  if(!confirm("حذف الملف نهائياً؟"))return;
  const {error:se}=await sb.storage.from(bucket).remove([path]);
  if(se)return alert(`تعذر حذف الملف من التخزين: ${se.message}`);
  const {error:de}=await sb.from("media").delete().eq("id",id);
  if(de)return alert(`حُذف الملف من التخزين لكن تعذر حذف السجل: ${de.message}`);
  await audit("delete","media",id,{bucket,path});await loadMedia();
}

async function saveService(e){e.preventDefault();const id=$("serviceId").value||null,p={name:$("serviceName").value.trim(),slug:$("serviceSlug").value.trim(),category:$("serviceCategory").value.trim()||null,icon:$("serviceIcon").value.trim()||"◆",summary:$("serviceSummary").value.trim()||null,description:$("serviceDescription").value.trim()||null,sort_order:+$("serviceSort").value||0,is_published:$("servicePublished").checked};const r=id?await sb.from("services").update(p).eq("id",id).select().single():await sb.from("services").insert(p).select().single();if(r.error)return alert(r.error.message);await audit(id?"update":"create","service",r.data.id,p);e.target.reset();$("serviceId").value="";await loadServices();}
async function loadServices(){const {data}=await sb.from("services").select("*").order("sort_order");$("servicesRows").innerHTML=(data||[]).map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.category||"")}</td><td>${x.is_published?"منشورة":"مخفية"}</td><td><button class="admin-btn" onclick='editService(${JSON.stringify(x).replace(/'/g,"&#39;")})'>تعديل</button></td></tr>`).join("");}
function editService(x){$("serviceId").value=x.id;$("serviceName").value=x.name||"";$("serviceSlug").value=x.slug||"";$("serviceCategory").value=x.category||"";$("serviceIcon").value=x.icon||"";$("serviceSummary").value=x.summary||"";$("serviceDescription").value=x.description||"";$("serviceSort").value=x.sort_order||0;$("servicePublished").checked=!!x.is_published;}

async function saveOffer(e){e.preventDefault();const id=$("offerId").value||null,p={title:$("offerTitle").value.trim(),badge:$("offerBadge").value.trim()||null,summary:$("offerSummary").value.trim()||null,starts_at:$("offerStart").value||null,ends_at:$("offerEnd").value||null,sort_order:+$("offerSort").value||0,is_published:$("offerPublished").checked};const r=id?await sb.from("offers").update(p).eq("id",id).select().single():await sb.from("offers").insert(p).select().single();if(r.error)return alert(r.error.message);await audit(id?"update":"create","offer",r.data.id,p);e.target.reset();$("offerId").value="";await loadOffers();}
async function loadOffers(){const {data}=await sb.from("offers").select("*").order("sort_order");$("offersRows").innerHTML=(data||[]).map(x=>`<tr><td>${esc(x.title)}</td><td>${esc(x.badge||"")}</td><td>${x.ends_at&&x.ends_at<new Date().toISOString().slice(0,10)?"منتهي":(x.is_published?"منشور":"مخفي")}</td><td><button class="admin-btn" onclick='editOffer(${JSON.stringify(x).replace(/'/g,"&#39;")})'>تعديل</button></td></tr>`).join("");}
function editOffer(x){$("offerId").value=x.id;$("offerTitle").value=x.title||"";$("offerBadge").value=x.badge||"";$("offerSummary").value=x.summary||"";$("offerStart").value=x.starts_at||"";$("offerEnd").value=x.ends_at||"";$("offerSort").value=x.sort_order||0;$("offerPublished").checked=!!x.is_published;}

async function saveContract(e){
  e.preventDefault();
  const p={customer_id:$("contractCustomer").value,event_id:$("contractEvent").value||null,title:$("contractTitle").value.trim(),body:$("contractBody").value,total_value:+$("contractTotal").value||null,deposit_required:+$("contractDeposit").value||null,status:"draft"};
  const {data,error}=await sb.from("contracts").insert(p).select().single();if(error)return alert(error.message);
  await sb.from("contract_versions").insert({contract_id:data.id,version:1,body:p.body,total_value:p.total_value,deposit_required:p.deposit_required,snapshot:p});
  await audit("create","contract",data.id,{});e.target.reset();await loadContracts();
}
async function loadContracts(){if(!$("contractsRows"))return;const {data}=await sb.from("contracts").select("*").order("created_at",{ascending:false});$("contractsRows").innerHTML=(data||[]).map(x=>`<tr><td>${esc(x.contract_no||"")}</td><td>${esc(x.title)}</td><td>${esc(x.status)}</td><td>${money(x.total_value)}</td><td><button class="admin-btn" onclick="sendContract('${x.id}')">إرسال للعميل</button></td></tr>`).join("");}
async function sendContract(id){const {error}=await sb.from("contracts").update({status:"sent",sent_at:new Date().toISOString()}).eq("id",id);if(error)return alert(error.message);await audit("send","contract",id,{});await loadContracts();}

function weekStartSaturday(d=new Date()){const x=new Date(d);const diff=(x.getDay()+1)%7;x.setHours(0,0,0,0);x.setDate(x.getDate()-diff);return x;}
async function savePayment(e){e.preventDefault();const event_id=$("payEvent").value||null,p={event_id,amount:+$("payAmount").value,payment_type:$("payType").value,payment_method:$("payMethod").value.trim()||null};if(event_id){const {data:ev}=await sb.from("events").select("customer_id,booking_id").eq("id",event_id).single();p.customer_id=ev?.customer_id||null;p.booking_id=ev?.booking_id||null;}const {data,error}=await sb.from("payments").insert(p).select().single();if(error)return alert(error.message);await audit("create","payment",data.id,p);e.target.reset();await loadFinance();}
async function saveExpense(e){e.preventDefault();const event_id=$("expEvent").value||null,p={event_id,category:$("expCategory").value.trim(),amount:+$("expAmount").value,vendor:$("expVendor").value.trim()||null};const {data,error}=await sb.from("expenses").insert(p).select().single();if(error)return alert(error.message);await audit("create","expense",data.id,p);e.target.reset();await loadFinance();}

async function saveStaff(e){e.preventDefault();const p={full_name:$("staffName").value.trim(),phone:$("staffPhone").value.trim()||null,specialty:$("staffSpecialty").value.trim()||null,default_fee:+$("staffFee").value||null};const {data,error}=await sb.from("staff_members").insert(p).select().single();if(error)return alert(error.message);await audit("create","staff",data.id,p);e.target.reset();await loadStaff();}
async function loadStaff(){const {data}=await sb.from("staff_members").select("*").order("full_name");$("staffRows").innerHTML=(data||[]).map(x=>`<tr><td>${esc(x.full_name)}</td><td>${esc(x.specialty||"")}</td><td>${money(x.default_fee)}</td><td>${x.is_active?"فعال":"موقوف"}</td></tr>`).join("");}

async function saveEquipment(e){e.preventDefault();const p={asset_code:$("eqCode").value.trim()||null,name:$("eqName").value.trim(),category:$("eqCategory").value.trim()||null,model:$("eqModel").value.trim()||null,serial_no:$("eqSerial").value.trim()||null,status:$("eqStatus").value};const {data,error}=await sb.from("equipment").insert(p).select().single();if(error)return alert(error.message);await audit("create","equipment",data.id,p);e.target.reset();await loadEquipment();}
async function loadEquipment(){const {data}=await sb.from("equipment").select("*").order("name");$("equipmentRows").innerHTML=(data||[]).map(x=>`<tr><td>${esc(x.asset_code||"")}</td><td>${esc(x.name)}</td><td>${esc(x.category||"")}</td><td>${esc(x.model||"")}</td><td>${esc(x.status)}</td></tr>`).join("");}

async function loadDeliverables(){const {data}=await sb.from("deliverables").select("*,events(title)").order("created_at",{ascending:false});$("deliverablesRows").innerHTML=(data||[]).map(x=>`<tr><td>${esc(x.events?.title||"")}</td><td>${esc(x.title)}</td><td><select onchange="updateDeliverable('${x.id}',this.value)">${["pending","in_progress","review","revision","ready","delivered"].map(s=>`<option ${x.status===s?"selected":""}>${s}</option>`).join("")}</select></td><td>${x.current_revision||0}</td><td>${x.due_at?.slice(0,10)||""}</td></tr>`).join("");}
async function updateDeliverable(id,status){const p={status};if(status==="delivered")p.delivered_at=new Date().toISOString();const {error}=await sb.from("deliverables").update(p).eq("id",id);if(error)return alert(error.message);await audit("status_update","deliverable",id,p);}

async function loadComplaints(){const {data}=await sb.from("complaints").select("*").order("created_at",{ascending:false});$("complaintsRows").innerHTML=(data||[]).map(x=>`<tr><td>${esc(x.tracking_code)}</td><td>${esc(x.customer_name)}</td><td>${esc(x.subject)}</td><td>${esc(x.priority)}</td><td><select onchange="updateComplaint('${x.id}',this.value)">${Object.entries(complaintLabels).map(([k,v])=>`<option value="${k}" ${x.status===k?"selected":""}>${v}</option>`).join("")}</select></td></tr>`).join("");}
async function updateComplaint(id,status){const p={status};if(status==="resolved")p.resolved_at=new Date().toISOString();const {error}=await sb.from("complaints").update(p).eq("id",id);if(error)return alert(error.message);await audit("status_update","complaint",id,p);await loadDashboard();}

async function loadReviews(){const {data}=await sb.from("reviews").select("*").order("created_at",{ascending:false});$("reviewsRows").innerHTML=(data||[]).map(x=>`<tr><td>${esc(x.reviewer_name||"")}</td><td>${"★".repeat(x.rating||0)}</td><td>${esc(x.review_text||"")}</td><td>${x.is_approved?"منشور":"معلق"}</td><td><button class="admin-btn" onclick="approveReview('${x.id}',${!x.is_approved})">${x.is_approved?"إخفاء":"اعتماد"}</button></td></tr>`).join("");}
async function approveReview(id,is_approved){const {error}=await sb.from("reviews").update({is_approved,published_at:is_approved?new Date().toISOString():null}).eq("id",id);if(error)return alert(error.message);await audit("review_approval","review",id,{is_approved});await loadReviews();}


async function inviteUser(e){e.preventDefault();const payload={full_name:$("inviteName").value.trim(),email:$("inviteEmail").value.trim(),role:$("inviteRole").value,customer_id:$("inviteCustomer").value||null};const {data,error}=await sb.functions.invoke("invite-user",{body:payload});if(error)return alert(error.message);await audit("invite","profile",data?.user_id,payload);e.target.reset();await loadUsers();}
async function loadUsers(){
  if(currentProfile?.role!=="super_admin")return;
  const {data,error}=await sb.from("profiles").select("*").order("created_at");
  if(error)return alert(error.message);
  $("usersRows").innerHTML=(data||[]).map(x=>{const self=x.id===currentUser.id;return `<tr><td>${esc(x.full_name||"")}${self?' <span class="self-chip">أنت</span>':''}</td><td>${esc(x.role)}</td><td>${x.is_active?"فعال":"موقوف"}</td><td>${x.mfa_required?"MFA":""}</td><td><button class="admin-btn danger" ${self?'disabled title="لا يمكن إيقاف الحساب المستخدم حالياً"':''} onclick="toggleUser('${x.id}',${!x.is_active})">${self?"حسابك":(x.is_active?"إيقاف":"تفعيل")}</button></td></tr>`}).join("");
}
async function toggleUser(id,is_active){
  if(id===currentUser.id&&!is_active)return alert("لا يمكنك إيقاف الحساب الذي تستخدمه الآن.");
  if(!confirm(`${is_active?"تفعيل":"إيقاف"} هذا المستخدم؟`))return;
  const {error}=await sb.from("profiles").update({is_active}).eq("id",id);
  if(error)return alert(error.message);
  await audit("active_change","profile",id,{is_active});await loadUsers();
}

async function loadAudit(){if(!["super_admin","admin"].includes(currentProfile?.role))return;const {data}=await sb.from("audit_logs").select("*").order("created_at",{ascending:false}).limit(300);$("auditRows").innerHTML=(data||[]).map(x=>`<tr><td>${new Date(x.created_at).toLocaleString("ar")}</td><td>${esc(x.user_id||"")}</td><td>${esc(x.action)}</td><td>${esc(x.entity_type)}</td><td>${esc(x.entity_id||"")}</td></tr>`).join("");}

async function exportBackup(){
  const tables=["customers","profiles","services","offers","bookings","events","media","contracts","contract_versions","payments","expenses","staff_members","event_staff_assignments","equipment","equipment_assignments","deliverables","deliverable_revisions","complaints","complaint_messages","reviews","site_settings","audit_logs"];
  const snap={exported_at:new Date().toISOString(),version:"StudioOS V22",tables:{}};
  for(const t of tables){const {data,error}=await sb.from(t).select("*");snap.tables[t]=error?{error:error.message}:data;}
  const blob=new Blob([JSON.stringify(snap,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=`sultan-studioos-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(url);
  await sb.from("backup_runs").insert({backup_type:"manual-json",status:"completed",object_count:tables.length,notes:"Data snapshot + media manifest only. Binary storage files require separate backup.",created_by:currentUser.id});
  await audit("export","backup",null,{tables:tables.length});
}

Object.assign(window,{login,logout,verifyMfa,openView,saveCustomer,editCustomer,updateBookingStage,createEventFromBooking,loadCalendar,saveEvent,editEvent,uploadMedia,deleteMedia,saveService,editService,saveOffer,editOffer,saveContract,sendContract,savePayment,saveExpense,saveStaff,saveEquipment,saveDeliverable,updateDeliverable,updateComplaint,approveReview,saveSettings,inviteUser,toggleUser,exportBackup});
init();


async function assignStaff(e){
  e.preventDefault();
  const event_id=$("assignStaffEvent").value,staff_member_id=$("assignStaffMember").value;
  const {data:target}=await sb.from("events").select("event_date,title").eq("id",event_id).single();
  if(target?.event_date){
    const {data:existing}=await sb.from("event_staff_assignments").select("id,events(title,event_date)").eq("staff_member_id",staff_member_id).neq("status","cancelled");
    const clash=(existing||[]).find(x=>x.events?.event_date===target.event_date);
    if(clash&&!confirm(`تنبيه: هذا الموظف معيّن على "${clash.events.title}" بنفس التاريخ. متابعة؟`)) return;
  }
  const p={event_id,staff_member_id,role_label:$("assignStaffRole").value.trim()||null,agreed_fee:+$("assignStaffFee").value||null,call_time:$("assignStaffCall").value?new Date($("assignStaffCall").value).toISOString():null,status:"assigned"};
  const {data,error}=await sb.from("event_staff_assignments").insert(p).select().single();
  if(error)return alert(error.message);
  await audit("assign","staff",data.id,p);e.target.reset();await loadStaffAssignments();await loadFinance();
}
async function loadStaffAssignments(){
  if(!$("staffAssignmentsRows"))return;
  const {data}=await sb.from("event_staff_assignments").select("*,events(title),staff_members(full_name)").order("created_at",{ascending:false}).limit(300);
  $("staffAssignmentsRows").innerHTML=(data||[]).map(x=>`<tr><td>${esc(x.events?.title||"")}</td><td>${esc(x.staff_members?.full_name||"")}</td><td>${esc(x.role_label||"")}</td><td>${money(x.agreed_fee)}</td><td>${esc(x.status)}</td></tr>`).join("");
}

async function assignEquipment(e){
  e.preventDefault();
  const equipment_id=$("assignEqItem").value;
  const p={
    event_id:$("assignEqEvent").value,
    equipment_id,
    staff_member_id:$("assignEqStaff").value||null,
    checked_out_at:new Date().toISOString(),
    due_back_at:$("assignEqDue").value?new Date($("assignEqDue").value).toISOString():null,
    condition_out:$("assignEqCondition").value.trim()||null
  };
  const {data,error}=await sb.from("equipment_assignments").insert(p).select().single();
  if(error)return alert(error.message);
  await sb.from("equipment").update({status:"assigned"}).eq("id",equipment_id);
  await audit("checkout","equipment",data.id,p);e.target.reset();await loadEquipment();await loadEquipmentAssignments();
}
async function loadEquipmentAssignments(){
  if(!$("equipmentAssignmentsRows"))return;
  const {data}=await sb.from("equipment_assignments").select("*,equipment(name),events(title),staff_members(full_name)").is("returned_at",null).order("created_at",{ascending:false});
  $("equipmentAssignmentsRows").innerHTML=(data||[]).map(x=>`<tr><td>${esc(x.equipment?.name||"")}</td><td>${esc(x.events?.title||"")}</td><td>${esc(x.staff_members?.full_name||"")}</td><td>${x.due_back_at?.slice(0,16)||""}</td><td><button class="admin-btn" onclick="returnEquipment('${x.id}','${x.equipment_id}')">إرجاع</button></td></tr>`).join("");
}
async function returnEquipment(assignmentId,equipmentId){
  const condition=prompt("حالة المعدة عند الإرجاع؟","سليمة")||"";
  const {error}=await sb.from("equipment_assignments").update({returned_at:new Date().toISOString(),condition_in:condition}).eq("id",assignmentId);
  if(error)return alert(error.message);
  await sb.from("equipment").update({status:"available"}).eq("id",equipmentId);
  await audit("return","equipment",assignmentId,{equipment_id:equipmentId,condition_in:condition});
  await loadEquipment();await loadEquipmentAssignments();
}

async function addComplaintMessage(e){
  e.preventDefault();
  const p={
    complaint_id:$("complaintSelect").value,
    author_user_id:currentUser.id,
    author_name:currentProfile.full_name||currentUser.email,
    body:$("complaintMessage").value.trim(),
    is_internal:$("complaintInternal").checked
  };
  const {data,error}=await sb.from("complaint_messages").insert(p).select().single();
  if(error)return alert(error.message);
  await audit("message","complaint",p.complaint_id,{is_internal:p.is_internal});
  e.target.reset();await loadComplaintMessages();
}
async function loadComplaintMessages(){
  if(!$("complaintMessagesRows"))return;
  const {data}=await sb.from("complaint_messages").select("*,complaints(tracking_code)").order("created_at",{ascending:false}).limit(100);
  $("complaintMessagesRows").innerHTML=(data||[]).map(x=>`<tr><td>${esc(x.complaints?.tracking_code||"")}</td><td>${x.is_internal?"داخلي":"للعميل"}</td><td>${esc(x.body)}</td><td>${new Date(x.created_at).toLocaleString("ar")}</td></tr>`).join("");
}

Object.assign(window,{assignStaff,assignEquipment,returnEquipment,addComplaintMessage});


// ===== StudioOS V3 final extensions =====
let lastFinanceRows=[];
function addQuoteItemRow(desc="",qty=1,price=0){
  const wrap=$("quoteItems"); if(!wrap) return;
  const row=document.createElement("div"); row.className="admin-form quote-item-row"; row.style.marginBottom="8px";
  row.innerHTML=`<div><label>الوصف</label><input class="qi-desc" value="${esc(desc)}" required></div><div><label>الكمية</label><input class="qi-qty" type="number" min="0.01" step="0.01" value="${qty}"></div><div><label>سعر الوحدة</label><input class="qi-price" type="number" min="0" step="0.01" value="${price}"></div><div style="display:flex;align-items:end"><button class="admin-btn danger" type="button">حذف</button></div>`;
  row.querySelector("button").onclick=()=>row.remove(); wrap.appendChild(row);
}
async function saveQuote(e){
  e.preventDefault();
  const items=$$("#quoteItems .quote-item-row").map((r,i)=>({description:r.querySelector(".qi-desc").value.trim(),quantity:+r.querySelector(".qi-qty").value||1,unit_price:+r.querySelector(".qi-price").value||0,sort_order:i})).filter(x=>x.description);
  if(!items.length){alert("أضف بنداً واحداً على الأقل");return;}
  const payload={customer_id:$("quoteCustomer").value,booking_id:$("quoteBooking").value||null,event_id:$("quoteEvent").value||null,title:$("quoteTitle").value.trim(),valid_until:$("quoteValid").value||null,discount:+$("quoteDiscount").value||0,notes:$("quoteNotes").value.trim()||null,status:"draft",created_by:currentUser.id};
  const {data:q,error}=await sb.from("quotes").insert(payload).select().single(); if(error)return alert(error.message);
  const {error:ie}=await sb.from("quote_items").insert(items.map(x=>({...x,quote_id:q.id}))); if(ie){await sb.from("quotes").delete().eq("id",q.id);return alert(ie.message);}
  await audit("create","quote",q.id,{items:items.length}); e.target.reset(); $("quoteItems").innerHTML=""; addQuoteItemRow(); await loadQuotes();
}
async function loadQuotes(){
  if(!$("quotesRows") || !currentProfile || !["super_admin","admin"].includes(currentProfile.role)) return;
  const {data}=await sb.from("quotes").select("*,customers(full_name)").order("created_at",{ascending:false});
  $("quotesRows").innerHTML=(data||[]).map(x=>`<tr><td>${esc(x.quote_no||"")}</td><td>${esc(x.customers?.full_name||"")}</td><td>${esc(x.title)}</td><td>${money(x.total)}</td><td>${esc(x.status)}</td><td><button class="admin-btn" onclick="sendQuote('${x.id}')">إرسال</button> <button class="admin-btn" onclick="quoteToContract('${x.id}')">تحويل لعقد</button></td></tr>`).join("");
}
async function sendQuote(id){const {error}=await sb.from("quotes").update({status:"sent",sent_at:new Date().toISOString()}).eq("id",id);if(error)return alert(error.message);await audit("send","quote",id,{});await loadQuotes();}
async function quoteToContract(id){
  const {data:q,error}=await sb.from("quotes").select("*,quote_items(*)").eq("id",id).single();if(error)return alert(error.message);
  const body=[q.notes||"",...(q.quote_items||[]).sort((a,b)=>a.sort_order-b.sort_order).map(i=>`${i.description} — ${i.quantity} × ${i.unit_price} = ${i.line_total}`)].filter(Boolean).join("\n");
  const p={customer_id:q.customer_id,booking_id:q.booking_id,event_id:q.event_id,title:q.title,body,total_value:q.total,deposit_required:null,status:"draft",created_by:currentUser.id};
  const {data:c,error:ce}=await sb.from("contracts").insert(p).select().single();if(ce)return alert(ce.message);
  await sb.from("contract_versions").insert({contract_id:c.id,version:1,body,total_value:q.total,snapshot:{from_quote:q.quote_no}});
  await audit("convert","quote_to_contract",c.id,{quote_id:id});alert("تم إنشاء عقد مسودة من العرض.");await loadContracts();
}

async function saveMaintenance(e){
  e.preventDefault(); const equipment_id=$("maintEquipment").value;
  const p={equipment_id,maintenance_type:$("maintType").value.trim(),vendor:$("maintVendor").value.trim()||null,cost:+$("maintCost").value||null,notes:$("maintNotes").value.trim()||null,status:"open",created_by:currentUser.id};
  const {data,error}=await sb.from("equipment_maintenance").insert(p).select().single();if(error)return alert(error.message);
  await sb.from("equipment").update({status:"maintenance"}).eq("id",equipment_id); await audit("maintenance_open","equipment",equipment_id,p);e.target.reset();await loadMaintenance();await loadEquipment();await fillSelectors();
}
async function loadMaintenance(){
  if(!$("maintenanceRows"))return;const {data}=await sb.from("equipment_maintenance").select("*,equipment(name)").order("reported_at",{ascending:false}).limit(300);
  $("maintenanceRows").innerHTML=(data||[]).map(x=>`<tr><td>${esc(x.equipment?.name||"")}</td><td>${esc(x.maintenance_type)}</td><td>${esc(x.status)}</td><td>${money(x.cost)}</td><td>${x.status!=="completed"?`<button class="admin-btn" onclick="completeMaintenance('${x.id}','${x.equipment_id}')">إغلاق</button>`:""}</td></tr>`).join("");
}
async function completeMaintenance(id,equipmentId){const {error}=await sb.from("equipment_maintenance").update({status:"completed",completed_at:new Date().toISOString()}).eq("id",id);if(error)return alert(error.message);await sb.from("equipment").update({status:"available"}).eq("id",equipmentId);await audit("maintenance_complete","equipment",equipmentId,{maintenance_id:id});await loadMaintenance();await loadEquipment();await fillSelectors();}

async function optimizeImageForWeb(file,maxDim=2200,quality=.84){
  if(!file.type.startsWith("image/") || file.type==="image/gif" || file.type==="image/svg+xml") return file;
  const bmp=await createImageBitmap(file); let w=bmp.width,h=bmp.height; const scale=Math.min(1,maxDim/Math.max(w,h));w=Math.round(w*scale);h=Math.round(h*scale);
  const canvas=document.createElement("canvas");canvas.width=w;canvas.height=h;canvas.getContext("2d",{alpha:false}).drawImage(bmp,0,0,w,h);bmp.close?.();
  const blob=await new Promise(r=>canvas.toBlob(r,"image/webp",quality));
  if(!blob)return file; const base=file.name.replace(/\.[^.]+$/,"-"); return new File([blob],base+"web.webp",{type:"image/webp"});
}
async function uploadMedia(e){
  e.preventDefault();
  const files=[...$("mediaFile").files];if(!files.length)return;
  const event_id=$("mediaEvent").value||null,vis=$("mediaVisibility").value;
  let customer_id=null,eventInfo=null;
  if(event_id){
    const {data:ev,error:ee}=await sb.from("events").select("customer_id,title,privacy_level,publication_permission,is_published").eq("id",event_id).single();
    if(ee)return alert(ee.message);
    eventInfo=ev;customer_id=ev?.customer_id||null;
  }
  if(vis==="public"){
    if(!event_id)return alert("الملف العام يجب أن يكون مرتبطاً بمناسبة محددة.");
    if(eventInfo?.privacy_level!=="public"||!eventInfo?.publication_permission)return alert("لرفع ملف عام: اجعل خصوصية المناسبة عامة وفعّل موافقة النشر أولاً.");
    if(!eventInfo?.is_published&&!confirm("المناسبة غير منشورة بعد، لكن الملف سيُرفع إلى مساحة عامة. متابعة؟"))return;
  }
  const bucket=vis==="public"?(cfg.publicBucket||"public-media"):(cfg.privateBucket||"private-media");
  const prefix=vis==="public"?`events/${event_id}`:(customer_id?`customers/${customer_id}`:"studio-private");
  const folder=$("mediaFolder").value.trim()||"general",baseSort=+$("mediaSort").value||0,opt=$("mediaOptimize").checked;
  let done=0;const status=$("mediaUploadStatus");
  for(let i=0;i<files.length;i++){
    let f=files[i];
    if(f.size>50*1024*1024){status.textContent=`تم تجاهل ${f.name}: أكبر من 50MB`;continue;}
    if(opt&&vis==="public"&&f.type.startsWith("image/"))f=await optimizeImageForWeb(f);
    const safe=f.name.replace(/[^\w.\-]+/g,"_"),path=`${prefix}/${folder}/${Date.now()}-${i}-${safe}`;
    status.textContent=`رفع ${i+1} من ${files.length}: ${f.name}`;
    const {error:ue}=await sb.storage.from(bucket).upload(path,f,{cacheControl:"3600"});
    if(ue){status.textContent=`خطأ في ${f.name}: ${ue.message}`;continue;}
    let public_url=null;if(bucket==="public-media")public_url=sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    const {data,error}=await sb.from("media").insert({file_name:f.name,bucket_id:bucket,storage_path:path,public_url,mime_type:f.type,folder,visibility:vis,customer_id,event_id,sort_order:baseSort+i}).select().single();
    if(error){await sb.storage.from(bucket).remove([path]);status.textContent=`تعذر حفظ سجل ${f.name}: ${error.message}`;continue;}
    done++;await audit("upload","media",data.id,{path,bucket,vis,event_id});
  }
  status.textContent=`تم رفع ${done} من ${files.length} ملف.`;e.target.reset();await loadMedia();
}
async function loadMedia(){
  const {data}=await sb.from("media").select("*,events(title)").order("created_at",{ascending:false}).limit(500);
  $("mediaRows").innerHTML=(data||[]).map(x=>`<tr><td>${x.public_url&&x.mime_type?.startsWith("image/")?`<img class="media-preview" src="${esc(x.public_url)}">`:(x.visibility==="private"?"🔒":"ملف")}</td><td>${esc(x.file_name)}</td><td>${esc(x.visibility)}</td><td>${esc(x.events?.title||"")}</td><td>${x.event_id&&x.visibility==="public"&&x.mime_type?.startsWith("image/")?`<button class="admin-btn" onclick="setEventCover('${x.event_id}','${x.id}')">غلاف</button> `:""}<button class="admin-btn" onclick="setMediaSort('${x.id}',${x.sort_order||0})">ترتيب</button> <button class="admin-btn danger" onclick="deleteMedia('${x.id}','${x.bucket_id}','${String(x.storage_path).replace(/'/g,"")}')">حذف</button></td></tr>`).join("");
}
async function setEventCover(eventId,mediaId){await sb.from("media").update({is_cover:false}).eq("event_id",eventId);const {error}=await sb.from("media").update({is_cover:true}).eq("id",mediaId);if(error)return alert(error.message);await sb.from("events").update({cover_media_id:mediaId}).eq("id",eventId);await audit("cover_change","event",eventId,{media_id:mediaId});await loadMedia();}
async function setMediaSort(id,current){const value=prompt("رقم الترتيب",String(current??0));if(value===null)return;const {error}=await sb.from("media").update({sort_order:+value||0}).eq("id",id);if(error)return alert(error.message);await loadMedia();}

async function saveDeliverable(e){
  e.preventDefault();const event_id=$("delEvent").value;const {data:ev}=await sb.from("events").select("customer_id").eq("id",event_id).single();
  const p={event_id,customer_id:ev?.customer_id||null,title:$("delTitle").value.trim(),deliverable_type:$("delType").value,due_at:$("delDue").value?new Date($("delDue").value).toISOString():null,status:"pending"};
  const file=$("delFile")?.files?.[0];
  if(file){if(!p.customer_id)return alert("اربط المناسبة بعميل قبل رفع ملف تسليم خاص.");if(file.size>50*1024*1024)return alert("الملف أكبر من حد الرفع الحالي 50MB. استخدم رابط فيديو خارجي أو ملفاً أصغر.");const bucket=cfg.privateBucket||"private-media",safe=file.name.replace(/[^\w.\-]+/g,"_"),path=`customers/${p.customer_id}/deliverables/${event_id}/${Date.now()}-${safe}`;const {error:ue}=await sb.storage.from(bucket).upload(path,file,{cacheControl:"3600"});if(ue)return alert(ue.message);p.bucket_id=bucket;p.storage_path=path;p.status="ready";}
  const {data,error}=await sb.from("deliverables").insert(p).select().single();if(error)return alert(error.message);await audit("create","deliverable",data.id,{has_file:!!file});e.target.reset();await loadDeliverables();await loadDashboard();
}

async function loadNotifications(){
  if(!$("notificationRows"))return;const {data}=await sb.from("notifications").select("*").eq("user_id",currentUser.id).order("created_at",{ascending:false}).limit(30);
  $("notificationRows").innerHTML=(data||[]).length?(data||[]).map(n=>`<div style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,.06);${n.read_at?"opacity:.55":""}"><b>${esc(n.title)}</b> — ${esc(n.body||"")} ${!n.read_at?`<button class="admin-btn" onclick="markNotificationRead('${n.id}')">تمت القراءة</button>`:""}</div>`).join(""):"لا توجد إشعارات.";
}
async function markNotificationRead(id){await sb.from("notifications").update({read_at:new Date().toISOString()}).eq("id",id);await loadNotifications();}
let globalSearchTimer=null;
function setupGlobalSearch(){const el=$("globalSearch");if(!el||el.dataset.ready)return;el.dataset.ready="1";el.addEventListener("input",()=>{clearTimeout(globalSearchTimer);globalSearchTimer=setTimeout(runGlobalSearch,250);});}
async function runGlobalSearch(){const q=$("globalSearch").value.trim(),box=$("globalSearchResults");if(q.length<2){box.innerHTML="";return;}const pattern=`%${q.replace(/[%_]/g,"")}%`;const [c,b,e]=await Promise.all([sb.from("customers").select("id,full_name,phone,city").or(`full_name.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern}`).limit(8),sb.from("bookings").select("id,reference_no,customer_name,event_type,event_date").or(`reference_no.ilike.${pattern},customer_name.ilike.${pattern},phone.ilike.${pattern}`).limit(8),sb.from("events").select("id,title,event_type,event_date,city").or(`title.ilike.${pattern},city.ilike.${pattern},venue.ilike.${pattern}`).limit(8)]);box.innerHTML=[...(c.data||[]).map(x=>`عميل: <b>${esc(x.full_name)}</b> — ${esc(x.phone||"")}`),...(b.data||[]).map(x=>`حجز: <b>${esc(x.reference_no||"")}</b> — ${esc(x.customer_name)}`),...(e.data||[]).map(x=>`مناسبة: <b>${esc(x.title)}</b> — ${esc(x.event_date||"")}`)].map(x=>`<div style="padding:6px 0">${x}</div>`).join("")||"لا توجد نتائج.";}

async function loadSnapshots(){if(!$("snapshotRows")||!["super_admin","admin"].includes(currentProfile.role))return;const {data}=await sb.from("financial_snapshots").select("*").order("period_end",{ascending:false}).limit(60);$("snapshotRows").innerHTML=(data||[]).map(x=>`<tr><td>${x.period_type==="week"?"أسبوع":"شهر"}</td><td>${x.period_start}</td><td>${x.period_end}</td><td>${money(x.total_income)}</td><td>${money(x.total_expenses)}</td><td>${money(x.staff_cost)}</td><td>${money(x.net)}</td><td>${x.bookings_count}</td></tr>`).join("");}
async function loadFinance(){
  if(!$("weekIncome")||!["super_admin","admin"].includes(currentProfile.role))return;
  const now=new Date(),ws=weekStartSaturday(now),ms=new Date(now.getFullYear(),now.getMonth(),1),nextm=new Date(now.getFullYear(),now.getMonth()+1,1);
  const [wp,we,mp,me,summary]=await Promise.all([sb.from("payments").select("amount,payment_type").gte("paid_at",ws.toISOString()),sb.from("expenses").select("amount").gte("expense_date",ws.toISOString().slice(0,10)),sb.from("payments").select("amount,payment_type").gte("paid_at",ms.toISOString()).lt("paid_at",nextm.toISOString()),sb.from("expenses").select("amount").gte("expense_date",ms.toISOString().slice(0,10)).lt("expense_date",nextm.toISOString().slice(0,10)),sb.rpc("admin_financial_summary")]);
  const sumPay=a=>(a||[]).reduce((s,x)=>s+(x.payment_type==="refund"?-Number(x.amount):Number(x.amount)),0),sumExp=a=>(a||[]).reduce((s,x)=>s+Number(x.amount),0);
  $("weekIncome").textContent=money(sumPay(wp.data));$("weekExpense").textContent=money(sumExp(we.data));$("monthIncome").textContent=money(sumPay(mp.data));$("monthExpense").textContent=money(sumExp(me.data));lastFinanceRows=summary.data||[];
  $("financeRows").innerHTML=lastFinanceRows.map(x=>`<tr><td>${esc(x.title)}</td><td>${money(x.income)}</td><td>${money(x.expenses)}</td><td>${money(x.staff_cost)}</td><td class="${Number(x.net)>=0?"positive":"negative"}">${money(x.net)}</td></tr>`).join("");await loadSnapshots();
}
function currentWeekRange(){const end=new Date(),start=weekStartSaturday(end);return [start.toISOString().slice(0,10),end.toISOString().slice(0,10)];}
function currentMonthRange(){const n=new Date(),s=new Date(n.getFullYear(),n.getMonth(),1);return [s.toISOString().slice(0,10),n.toISOString().slice(0,10)];}
async function createManualSnapshot(type){const [start,end]=type==="week"?currentWeekRange():currentMonthRange();const {error}=await sb.rpc("create_financial_snapshot",{p_type:type,p_start:start,p_end:end});if(error)return alert(error.message);await audit("close_period","finance",null,{type,start,end});await loadSnapshots();}
function exportFinanceCsv(){const rows=[["المناسبة","الدخل","المصاريف","أجور الطاقم","الصافي"],...lastFinanceRows.map(x=>[x.title,x.income,x.expenses,x.staff_cost,x.net])];const csv="\ufeff"+rows.map(r=>r.map(v=>`"${String(v??"").replaceAll('"','""')}"`).join(",")).join("\n");const b=new Blob([csv],{type:"text/csv;charset=utf-8"}),u=URL.createObjectURL(b),a=document.createElement("a");a.href=u;a.download=`sultan-finance-${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(u);}
function printFinanceReport(){const w=window.open("","_blank");if(!w)return;w.document.write(`<html dir="rtl"><head><meta charset="utf-8"><title>تقرير المالية</title><style>body{font-family:Arial;padding:30px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #aaa;padding:8px;text-align:right}</style></head><body><h1>ستوديو وتسجيلات السلطان — تقرير المالية</h1><p>${new Date().toLocaleString("ar")}</p><table><tr><th>المناسبة</th><th>الدخل</th><th>المصاريف</th><th>الطاقم</th><th>الصافي</th></tr>${lastFinanceRows.map(x=>`<tr><td>${esc(x.title)}</td><td>${x.income}</td><td>${x.expenses}</td><td>${x.staff_cost}</td><td>${x.net}</td></tr>`).join("")}</table></body></html>`);w.document.close();w.print();}

async function uploadSiteAsset(file,label){if(!file)return null;let f=file;if(file.type.startsWith("image/"))f=await optimizeImageForWeb(file,label==="cover"?2400:1200,.88);const bucket=cfg.publicBucket||"public-media",safe=f.name.replace(/[^\w.\-]+/g,"_"),path=`site/${label}-${Date.now()}-${safe}`;const {error}=await sb.storage.from(bucket).upload(path,f,{cacheControl:"86400"});if(error)throw error;return sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;}
async function loadSettings(){if(!$("setName")||!["super_admin","admin"].includes(currentProfile.role))return;const {data}=await sb.from("site_settings").select("value").eq("key","business").maybeSingle();const s=data?.value||{};$("setName").value=s.name||"";$("setTagline").value=s.tagline||"";$("setFacebook").value=s.facebook||"";$("setYoutube").value=s.youtube||"";$("setWhatsapp").value=s.whatsapp||"";$("setGoogle").value=s.google||"";$("setPhone").value=s.phone||"";$("setCity").value=s.city||"";$("setRegion").value=s.region||"";if($("setAnalytics"))$("setAnalytics").value=s.google_analytics_id||"";if($("setCfAnalytics"))$("setCfAnalytics").value=s.cloudflare_analytics_token||"";}
async function saveSettings(e){e.preventDefault();try{const {data:old}=await sb.from("site_settings").select("value").eq("key","business").maybeSingle();const value={...(old?.value||{}),name:$("setName").value.trim(),tagline:$("setTagline").value.trim(),facebook:$("setFacebook").value.trim(),youtube:$("setYoutube").value.trim(),whatsapp:$("setWhatsapp").value.trim(),google:$("setGoogle").value.trim(),phone:$("setPhone").value.trim(),city:$("setCity").value.trim(),region:$("setRegion").value.trim(),google_analytics_id:$("setAnalytics").value.trim(),cloudflare_analytics_token:$("setCfAnalytics").value.trim(),currency:"ILS"};const lf=$("setLogoFile")?.files?.[0],cf=$("setCoverFile")?.files?.[0];if(lf)value.logo_url=await uploadSiteAsset(lf,"logo");if(cf)value.cover_url=await uploadSiteAsset(cf,"cover");const {error}=await sb.from("site_settings").upsert({key:"business",value,updated_by:currentUser.id});if(error)throw error;await audit("update","site_settings","business",{assets:!!(lf||cf)});alert("تم الحفظ");e.target.reset();await loadSettings();}catch(err){alert(err.message||err)}}

async function fillSelectors(){
  const [{data:customers},{data:events},{data:staff},{data:eq},{data:cmp},{data:bookings}]=await Promise.all([sb.from("customers").select("id,full_name").order("full_name"),sb.from("events").select("id,title").order("event_date",{ascending:false}),sb.from("staff_members").select("id,full_name").eq("is_active",true).order("full_name"),sb.from("equipment").select("id,name,status").order("name"),sb.from("complaints").select("id,tracking_code,subject").order("created_at",{ascending:false}).limit(200),sb.from("bookings").select("id,reference_no,customer_name,event_date").order("created_at",{ascending:false}).limit(300)]);
  const co=(customers||[]).map(x=>`<option value="${x.id}">${esc(x.full_name)}</option>`).join(""),ev='<option value="">—</option>'+(events||[]).map(x=>`<option value="${x.id}">${esc(x.title)}</option>`).join(""),st='<option value="">—</option>'+(staff||[]).map(x=>`<option value="${x.id}">${esc(x.full_name)}</option>`).join(""),eqAll='<option value="">—</option>'+(eq||[]).map(x=>`<option value="${x.id}">${esc(x.name)} — ${esc(x.status)}</option>`).join(""),eqAvail='<option value="">—</option>'+(eq||[]).map(x=>`<option value="${x.id}" ${x.status!=="available"?"disabled":""}>${esc(x.name)} — ${esc(x.status)}</option>`).join(""),cm='<option value="">—</option>'+(cmp||[]).map(x=>`<option value="${x.id}">${esc(x.tracking_code)} — ${esc(x.subject)}</option>`).join(""),bk='<option value="">—</option>'+(bookings||[]).map(x=>`<option value="${x.id}">${esc(x.reference_no||"")} — ${esc(x.customer_name)} — ${esc(x.event_date||"")}</option>`).join("");
  ["contractCustomer","inviteCustomer","quoteCustomer"].forEach(id=>{if($(id))$(id).innerHTML='<option value="">—</option>'+co});["contractEvent","payEvent","expEvent","delEvent","mediaEvent","assignStaffEvent","assignEqEvent","quoteEvent"].forEach(id=>{if($(id))$(id).innerHTML=ev});["assignStaffMember","assignEqStaff"].forEach(id=>{if($(id))$(id).innerHTML=st});if($("assignEqItem"))$("assignEqItem").innerHTML=eqAvail;if($("maintEquipment"))$("maintEquipment").innerHTML=eqAll;if($("complaintSelect"))$("complaintSelect").innerHTML=cm;if($("quoteBooking"))$("quoteBooking").innerHTML=bk;
}
async function loadAll(){
  const common=[loadDashboard(),loadCustomers(),loadBookings(),loadCalendar(),loadEvents(),loadMedia(),loadStaff(),loadStaffAssignments(),loadEquipment(),loadEquipmentAssignments(),loadMaintenance(),loadDeliverables(),loadComplaints(),loadComplaintMessages(),loadReviews(),loadNotifications(),loadAudit()];
  if(["super_admin","admin"].includes(currentProfile.role)) common.push(loadServices(),loadOffers(),loadQuotes(),loadContracts(),loadFinance(),loadSettings());
  if(currentProfile.role==="super_admin") common.push(loadUsers()); await Promise.all(common); await fillSelectors(); setupGlobalSearch(); if($("quoteItems")&&!$("quoteItems").children.length)addQuoteItemRow();
}
Object.assign(window,{addQuoteItemRow,saveQuote,sendQuote,quoteToContract,saveMaintenance,completeMaintenance,uploadMedia,setEventCover,setMediaSort,saveDeliverable,markNotificationRead,createManualSnapshot,exportFinanceCsv,printFinanceReport,saveSettings});
