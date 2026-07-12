/* =====================================================================
   DATA LAYER
   NOTE: This demo persists data using the browser's localStorage, so
   accounts and requests are saved on whichever device/browser is used
   to submit or manage them. That's fine for trying the system out
   locally, but it means a Student and an Admin only share the same
   data if they're using the same browser on the same machine (or the
   site is later wired up to a real shared backend/database).
===================================================================== */
const LS_USERS_KEY = 'regoffice_users';
const LS_REQUESTS_KEY = 'regoffice_requests';
const DOCUMENT_TYPES = [
  { id:'tor',  name:'Transcript of Records', fee:150 },
  { id:'hd',   name:'Honorable Dismissal', fee:100 },
  { id:'coe',  name:'Certificate of Enrollment', fee:50 },
  { id:'cgmc', name:'Certificate of Good Moral Character', fee:50 },
  { id:'dc',   name:'Diploma Copy (Certified True Copy)', fee:200 },
];
const STATUS = {
  PENDING: 'Pending Verification',
  PROCESSING: 'Processing',
  READY: 'Ready for Pickup',
  DONE: 'Completed',
  REJECTED: 'Rejected',
};

let currentUser = null;
let selectedProofData = null; // {name, type, dataUrl}
let activeAdminFilter = 'ALL';

async function hashPassword(pw){
  const enc = new TextEncoder().encode(pw);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

function readJSON(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  }catch(e){ return fallback; }
}
function writeJSON(key, value){
  try{
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  }catch(e){
    console.error('Storage write failed', e);
    return false;
  }
}

async function getUser(username){
  const users = readJSON(LS_USERS_KEY, {});
  return users[username] || null;
}
async function getAllUsers(){
  const users = readJSON(LS_USERS_KEY, {});
  return Object.values(users);
}
async function saveUser(user){
  const users = readJSON(LS_USERS_KEY, {});
  users[user.username] = user;
  return writeJSON(LS_USERS_KEY, users);
}
async function ensureSeedAdmin(){
  const existing = await getUser('admin');
  if(!existing){
    const hashed = await hashPassword('admin123');
    await saveUser({ username:'admin', password:hashed, role:'admin', name:'Registrar Admin' });
  }
}

async function getAllRequests(){
  const requests = readJSON(LS_REQUESTS_KEY, {});
  const items = Object.values(requests);
  items.sort((a,b)=> b.createdAt - a.createdAt);
  return items;
}
async function saveRequest(req){
  const requests = readJSON(LS_REQUESTS_KEY, {});
  requests[req.id] = req;
  return writeJSON(LS_REQUESTS_KEY, requests);
}
async function deleteRequest(id){
  const requests = readJSON(LS_REQUESTS_KEY, {});
  delete requests[id];
  writeJSON(LS_REQUESTS_KEY, requests);
}

function genId(){
  return Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2,6).toUpperCase();
}
function fmtDate(ts){
  const d = new Date(ts);
  return d.toLocaleDateString(undefined,{ year:'numeric', month:'short', day:'numeric' }) + ' \u00b7 ' +
         d.toLocaleTimeString(undefined,{ hour:'2-digit', minute:'2-digit' });
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function statusBadgeClass(status){
  if(status===STATUS.PENDING) return 'badge-pending';
  if(status===STATUS.PROCESSING) return 'badge-processing';
  if(status===STATUS.READY) return 'badge-ready';
  if(status===STATUS.DONE) return 'badge-done';
  return 'badge-rejected';
}
function statusStampClass(status){
  if(status===STATUS.PENDING) return 'pending';
  if(status===STATUS.PROCESSING) return 'processing';
  if(status===STATUS.READY) return 'ready';
  if(status===STATUS.DONE) return 'done';
  return 'rejected';
}
function statusStampLabel(status){
  if(status===STATUS.PENDING) return 'Awaiting Verification';
  if(status===STATUS.PROCESSING) return 'In Process';
  if(status===STATUS.READY) return 'Ready';
  if(status===STATUS.DONE) return 'Claimed';
  return 'Rejected';
}

/* =====================================================================
   AUTH
===================================================================== */
function setAuthMode(mode){
  document.getElementById('tab-login').classList.toggle('active', mode==='login');
  document.getElementById('tab-signup').classList.toggle('active', mode==='signup');
  document.getElementById('login-form-wrap').classList.toggle('hidden', mode!=='login');
  document.getElementById('signup-form-wrap').classList.toggle('hidden', mode!=='signup');
  hideError('login-error'); hideError('signup-error');
}
function showError(id, msg){ const el=document.getElementById(id); el.textContent=msg; el.classList.remove('hidden'); }
function hideError(id){ const el=document.getElementById(id); el.classList.add('hidden'); }

async function handleLogin(){
  const role = document.getElementById('login-role').value;
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  hideError('login-error');
  if(!username || !password){ showError('login-error','Enter your username and password.'); return; }

  const user = await getUser(username);
  if(!user){ showError('login-error','No account found with that username.'); return; }
  if(user.role !== role){ showError('login-error', `That account is registered as ${user.role}, not ${role}.`); return; }
  const hashed = await hashPassword(password);
  if(hashed !== user.password){ showError('login-error','Incorrect password.'); return; }

  currentUser = user;
  enterApp();
}

async function handleSignup(){
  const name = document.getElementById('signup-name').value.trim();
  const sid = document.getElementById('signup-sid').value.trim();
  const username = document.getElementById('signup-username').value.trim();
  const password = document.getElementById('signup-password').value;
  hideError('signup-error');
  if(!name || !sid || !username || !password){ showError('signup-error','Please fill in every field.'); return; }
  if(password.length < 6){ showError('signup-error','Password must be at least 6 characters.'); return; }

  const allUsers = await getAllUsers();
  const nameTaken = allUsers.some(u => u.name && u.name.trim().toLowerCase() === name.toLowerCase());
  if(nameTaken){ showError('signup-error','That full name is already registered.'); return; }
  const sidTaken = allUsers.some(u => u.studentId && u.studentId.trim().toLowerCase() === sid.toLowerCase());
  if(sidTaken){ showError('signup-error','That student ID is already registered.'); return; }
  const existing = await getUser(username);
  if(existing){ showError('signup-error','That username is already taken.'); return; }

  const hashed = await hashPassword(password);
  const user = { username, password:hashed, role:'student', name, studentId:sid, email:'', phone:'' };
  const ok = await saveUser(user);
  if(!ok){ showError('signup-error','Could not create account \u2014 storage limit reached.'); return; }
  currentUser = user;
  enterApp();
}

function handleLogout(){
  currentUser = null;
  document.getElementById('app-screen').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('login-username').value='';
  document.getElementById('login-password').value='';
  setAuthMode('login');
}

async function enterApp(){
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.remove('hidden');
  document.getElementById('who-name').textContent = currentUser.name;
  document.getElementById('who-role').textContent = currentUser.role === 'admin' ? 'Administrator' : ('Student \u00b7 ' + (currentUser.studentId||''));
  updateTopbarAvatar();

  document.getElementById('student-page').classList.toggle('hidden', currentUser.role!=='student');
  document.getElementById('admin-page').classList.toggle('hidden', currentUser.role!=='admin');

  if(currentUser.role==='student'){ await setStudentView('requests'); }
  else{ await setAdminView('queue'); }
}

/* =====================================================================
   STUDENT PAGE
===================================================================== */
let studentView = 'requests';

async function setStudentView(view){
  studentView = view;
  const subnav = document.getElementById('student-subnav');
  subnav.children[0].classList.toggle('active', view==='requests');
  subnav.children[1].classList.toggle('active', view==='profile');
  document.getElementById('student-requests-view').classList.toggle('hidden', view!=='requests');
  document.getElementById('student-profile-view').classList.toggle('hidden', view!=='profile');
  document.getElementById('student-new-request-btn').classList.toggle('hidden', view!=='requests');
  document.getElementById('student-page-title').textContent = view==='requests' ? 'My requests' : 'My profile';
  document.getElementById('student-page-sub').textContent = view==='requests'
    ? 'Track every document request from submission to pickup.'
    : 'Update your personal details and password.';

  if(view==='requests'){ await renderStudentPage(); }
  else{ renderStudentProfileView(); }
}

async function renderStudentPage(){
  const all = await getAllRequests();
  const mine = all.filter(r=>r.studentUsername===currentUser.username);
  const wrap = document.getElementById('student-tickets');

  if(mine.length===0){
    wrap.innerHTML = `
      <div class="empty-state">
        <div class="glyph">&#128220;</div>
        <h3>No requests yet</h3>
        <p>Start your first request and attach your proof of payment.</p>
        <button class="btn btn-brass" onclick="openNewRequestModal()">+ New request</button>
      </div>`;
    return;
  }

  wrap.innerHTML = `<div class="tickets">` + mine.map(r=>`
    <div class="ticket">
      <div class="ticket-main">
        <p class="doc-type">${escapeHtml(r.documentTypeName)}</p>
        <p class="ref">REF ${r.id}</p>
        <div class="meta">
          <div class="r"><span>Fee</span><b>&#8369;${r.fee}</b></div>
          <div class="r"><span>Submitted</span><b>${fmtDate(r.createdAt)}</b></div>
        </div>
        <span class="badge ${statusBadgeClass(r.status)}"><span class="badge-dot"></span>${r.status}</span>
        ${r.status===STATUS.REJECTED && r.rejectReason ? `<div class="reject-reason"><b>Reason:</b> ${escapeHtml(r.rejectReason)}</div>` : ''}
        ${r.status===STATUS.PENDING ? `<div style="margin-top:12px;"><button class="btn btn-outline btn-sm" onclick="cancelRequest('${r.id}')">Cancel request</button></div>` : ''}
      </div>
      <div class="ticket-stub">
        <div class="stamp ${statusStampClass(r.status)}">${statusStampLabel(r.status)}</div>
      </div>
    </div>
  `).join('') + `</div>`;
}

/* ---- Student profile ---- */
function renderStudentProfileView(){
  const u = currentUser;
  const wrap = document.getElementById('student-profile-view');
  wrap.innerHTML = `
    <div style="max-width:520px;">
      <div style="display:flex; align-items:center; gap:18px; margin-bottom:28px;">
        <div class="avatar-circle" style="width:74px; height:74px; font-size:24px;">${avatarInnerHtml(u)}</div>
        <div>
          <div class="upload-box" style="display:inline-flex; align-items:center; gap:8px; padding:9px 16px; border-radius:8px;">
            <input type="file" id="profile-avatar-input" accept="image/*" onchange="handleAvatarSelect(event)">
            <span class="txt" style="font-size:13px;">${u.avatar ? 'Change photo' : 'Upload photo'}</span>
          </div>
          ${u.avatar ? `<button class="btn btn-ghost btn-sm" onclick="removeAvatar()">Remove</button>` : ''}
          <div class="hint" style="margin-top:6px;">JPG or PNG &mdash; automatically resized and compressed.</div>
        </div>
      </div>
      <div class="field"><label>Full name</label><input type="text" id="profile-name" value="${escapeHtml(u.name)}"></div>
      <div class="field"><label>Student ID</label><input type="text" value="${escapeHtml(u.studentId||'')}" disabled style="background:#F2F3F5; color:var(--ink-faint);"></div>
      <div class="field"><label>Username</label><input type="text" value="${escapeHtml(u.username)}" disabled style="background:#F2F3F5; color:var(--ink-faint);"></div>
      <div class="field"><label>Email</label><input type="text" id="profile-email" value="${escapeHtml(u.email||'')}" placeholder="you@example.com"></div>
      <div class="field"><label>Phone</label><input type="text" id="profile-phone" value="${escapeHtml(u.phone||'')}" placeholder="09xx xxx xxxx"></div>
      <div id="profile-error" class="error-text hidden"></div>
      <div id="profile-success" class="hint hidden" style="color:var(--green); font-weight:600;"></div>
      <button class="btn btn-brass" onclick="saveProfile()">Save changes</button>

      <div style="margin-top:36px; padding-top:26px; border-top:1.5px solid var(--line);">
        <h2 class="serif" style="font-size:19px; font-weight:600; margin:0 0 4px;">Change password</h2>
        <p class="hint" style="margin:0 0 16px;">Enter your current password to set a new one.</p>
        <div class="field"><label>Current password</label><input type="password" id="pw-current"></div>
        <div class="field"><label>New password</label><input type="password" id="pw-new" placeholder="At least 6 characters"></div>
        <div class="field"><label>Confirm new password</label><input type="password" id="pw-confirm"></div>
        <div id="pw-error" class="error-text hidden"></div>
        <div id="pw-success" class="hint hidden" style="color:var(--green); font-weight:600;"></div>
        <button class="btn btn-outline" onclick="changePassword()">Update password</button>
      </div>
    </div>`;
}

function getInitials(name){
  if(!name) return '?';
  const parts = name.trim().split(/\s+/);
  const first = parts[0] ? parts[0][0] : '';
  const last = parts.length>1 ? parts[parts.length-1][0] : '';
  return (first+last).toUpperCase() || '?';
}
function avatarInnerHtml(u){
  return u.avatar
    ? `<img src="${u.avatar}" alt="Profile photo">`
    : getInitials(u.name);
}

async function handleAvatarSelect(evt){
  const file = evt.target.files[0];
  if(!file) return;
  if(!file.type.startsWith('image/')){ evt.target.value=''; return; }
  if(file.size > 8*1024*1024){
    showError('profile-error','Photo is too large. Please choose a smaller image.');
    evt.target.value = '';
    return;
  }
  hideError('profile-error');
  try{
    const resized = await resizeImageFile(file, 300, 0.85); // small thumbnail, auto-compressed
    currentUser.avatar = resized;
    const ok = await saveUser(currentUser);
    if(!ok){
      currentUser.avatar = '';
      showError('profile-error','Could not save photo — storage limit reached. Try a different image.');
      return;
    }
    renderStudentProfileView();
    updateTopbarAvatar();
  }catch(e){
    showError('profile-error','Could not process that image. Please try a different file.');
  }
  evt.target.value = '';
}

async function removeAvatar(){
  currentUser.avatar = '';
  await saveUser(currentUser);
  renderStudentProfileView();
  updateTopbarAvatar();
}

function updateTopbarAvatar(){
  const el = document.getElementById('who-avatar');
  if(el) el.innerHTML = avatarInnerHtml(currentUser);
}

async function saveProfile(){
  const name = document.getElementById('profile-name').value.trim();
  const email = document.getElementById('profile-email').value.trim();
  const phone = document.getElementById('profile-phone').value.trim();
  hideError('profile-error');
  document.getElementById('profile-success').classList.add('hidden');

  if(!name){ showError('profile-error','Full name is required.'); return; }

  const allUsers = await getAllUsers();
  const nameTaken = allUsers.some(u => u.username!==currentUser.username && u.name && u.name.trim().toLowerCase()===name.toLowerCase());
  if(nameTaken){ showError('profile-error','That full name is already registered to another account.'); return; }

  currentUser.name = name;
  currentUser.email = email;
  currentUser.phone = phone;
  await saveUser(currentUser);

  document.getElementById('who-name').textContent = currentUser.name;
  document.getElementById('who-role').textContent = 'Student \u00b7 ' + (currentUser.studentId||'');
  const successEl = document.getElementById('profile-success');
  successEl.textContent = 'Profile updated.';
  successEl.classList.remove('hidden');
}

async function changePassword(){
  const cur = document.getElementById('pw-current').value;
  const nw = document.getElementById('pw-new').value;
  const cf = document.getElementById('pw-confirm').value;
  hideError('pw-error');
  document.getElementById('pw-success').classList.add('hidden');

  if(!cur || !nw || !cf){ showError('pw-error','Fill in all password fields.'); return; }
  const curHash = await hashPassword(cur);
  if(curHash !== currentUser.password){ showError('pw-error','Current password is incorrect.'); return; }
  if(nw.length < 6){ showError('pw-error','New password must be at least 6 characters.'); return; }
  if(nw !== cf){ showError('pw-error','New password and confirmation do not match.'); return; }

  currentUser.password = await hashPassword(nw);
  await saveUser(currentUser);
  document.getElementById('pw-current').value = '';
  document.getElementById('pw-new').value = '';
  document.getElementById('pw-confirm').value = '';
  const successEl = document.getElementById('pw-success');
  successEl.textContent = 'Password updated.';
}

function openNewRequestModal(){
  selectedProofData = null;
  const options = DOCUMENT_TYPES.map(d=>`<option value="${d.id}">${d.name} \u2014 \u20B1${d.fee}</option>`).join('');
  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this) closeModal()">
      <div class="modal">
        <div class="modal-head">
          <h2>New document request</h2>
          <button class="modal-close" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
          <p class="subline">Select a document and attach your proof of payment.</p>
          <div class="field">
            <label>Document type</label>
            <select id="req-doctype" onchange="updateFeePreview()">${options}</select>
          </div>
          <div class="fee-preview">
            <span>Processing fee</span>
            <b id="fee-amount">&#8369;${DOCUMENT_TYPES[0].fee}</b>
          </div>
          <div class="field">
            <label>Proof of payment</label>
            <div id="upload-area">
              <div class="upload-box">
                <input type="file" id="req-file" accept="image/*,.pdf" onchange="handleFileSelect(event)">
                <div class="glyph">&#128206;</div>
                <div class="txt">Click to upload receipt or screenshot</div>
                <div class="sub">JPG, PNG or PDF &middot; up to 6MB (images are auto-compressed)</div>
              </div>
            </div>
          </div>
          <div id="req-error" class="error-text hidden"></div>
          <div class="action-row">
            <button class="btn btn-brass" style="flex:1;" onclick="submitNewRequest()">Submit request</button>
            <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
          </div>
        </div>
      </div>
    </div>`;
}

/* ---- Image resizing (keeps localStorage usage small) ---- */
function resizeImageFile(file, maxDim, quality){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if(width > maxDim || height > maxDim){
          if(width >= height){ height = Math.round(height * (maxDim / width)); width = maxDim; }
          else{ width = Math.round(width * (maxDim / height)); height = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Could not read image'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

function updateFeePreview(){
  const sel = document.getElementById('req-doctype').value;
  const doc = DOCUMENT_TYPES.find(d=>d.id===sel);
  document.getElementById('fee-amount').textContent = '\u20B1' + doc.fee;
}

async function handleFileSelect(evt){
  const file = evt.target.files[0];
  if(!file) return;
  if(file.size > 6*1024*1024){
    showError('req-error','File is too large. Please keep it under 6MB.');
    evt.target.value = '';
    return;
  }
  hideError('req-error');
  const isImg = file.type.startsWith('image/');

  try{
    let dataUrl, storedType;
    if(isImg){
      dataUrl = await resizeImageFile(file, 1400, 0.78); // shrink + compress, keeps receipt legible but small
      storedType = 'image/jpeg';
    } else {
      dataUrl = await new Promise((resolve, reject)=>{
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Could not read file'));
        reader.readAsDataURL(file);
      });
      storedType = file.type;
    }
    selectedProofData = { name:file.name, type:storedType, dataUrl };
    document.getElementById('upload-area').innerHTML = `
      <div class="file-chip">
        ${isImg ? `<img src="${dataUrl}">` : `<div class="icon" style="width:36px;height:36px;border-radius:5px;background:var(--red-bg);color:var(--red);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;">PDF</div>`}
        <span class="fname">${escapeHtml(file.name)}</span>
        <button onclick="clearFileSelect()">Remove</button>
      </div>`;
  }catch(e){
    showError('req-error','Could not process that file. Please try a different image or PDF.');
    evt.target.value = '';
  }
}
function clearFileSelect(){
  selectedProofData = null;
  document.getElementById('upload-area').innerHTML = `
    <div class="upload-box">
      <input type="file" id="req-file" accept="image/*,.pdf" onchange="handleFileSelect(event)">
      <div class="glyph">&#128206;</div>
      <div class="txt">Click to upload receipt or screenshot</div>
      <div class="sub">JPG, PNG or PDF &middot; up to 6MB (images are auto-compressed)</div>
    </div>`;
}

async function submitNewRequest(){
  const sel = document.getElementById('req-doctype').value;
  const doc = DOCUMENT_TYPES.find(d=>d.id===sel);
  if(!selectedProofData){ showError('req-error','Please attach your proof of payment.'); return; }

  const req = {
    id: genId(),
    studentUsername: currentUser.username,
    studentName: currentUser.name,
    studentId: currentUser.studentId || '',
    documentTypeId: doc.id,
    documentTypeName: doc.name,
    fee: doc.fee,
    proofFileName: selectedProofData.name,
    proofType: selectedProofData.type,
    proofDataUrl: selectedProofData.dataUrl,
    status: STATUS.PENDING,
    rejectReason: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const ok = await saveRequest(req);
  if(!ok){
    showError('req-error','Could not submit \u2014 storage limit reached. Try a smaller photo or PDF.');
    return;
  }
  closeModal();
  await renderStudentPage();
}

async function cancelRequest(reqId){
  const confirmed = window.confirm('Cancel this request? This cannot be undone, and the admin will no longer see it.');
  if(!confirmed) return;
  await deleteRequest(reqId);
  await renderStudentPage();
}

/* =====================================================================
   ADMIN PAGE
===================================================================== */
let adminView = 'queue';

async function setAdminView(view){
  adminView = view;
  const subnav = document.getElementById('admin-subnav');
  subnav.children[0].classList.toggle('active', view==='queue');
  subnav.children[1].classList.toggle('active', view==='students');
  document.getElementById('admin-queue-view').classList.toggle('hidden', view!=='queue');
  document.getElementById('admin-students-view').classList.toggle('hidden', view!=='students');
  document.getElementById('admin-page-title').textContent = view==='queue' ? 'Request queue' : 'Student accounts';
  document.getElementById('admin-page-sub').textContent = view==='queue'
    ? 'Verify payments and move requests through the pipeline.'
    : 'View registered students and their request activity.';

  if(view==='queue'){ await renderAdminPage(); }
  else{ await renderAdminStudentsView(); }
}

const ADMIN_FILTERS = [
  { key:'ALL', label:'All' },
  { key:STATUS.PENDING, label:'Pending' },
  { key:STATUS.PROCESSING, label:'Processing' },
  { key:STATUS.READY, label:'Ready for Pickup' },
  { key:STATUS.DONE, label:'Completed' },
  { key:STATUS.REJECTED, label:'Rejected' },
];

async function renderAdminPage(){
  const all = await getAllRequests();

  const tabsWrap = document.getElementById('admin-filter-tabs');
  tabsWrap.innerHTML = ADMIN_FILTERS.map(f=>{
    const count = f.key==='ALL' ? all.length : all.filter(r=>r.status===f.key).length;
    return `<button class="${activeAdminFilter===f.key?'active':''}" onclick="setAdminFilter('${f.key}')">${f.label} <span class="count">${count}</span></button>`;
  }).join('');

  const filtered = activeAdminFilter==='ALL' ? all : all.filter(r=>r.status===activeAdminFilter);
  const tableWrap = document.getElementById('admin-table-wrap');

  if(filtered.length===0){
    tableWrap.innerHTML = `
      <div class="empty-state">
        <div class="glyph">&#128193;</div>
        <h3>Nothing here</h3>
        <p>No requests currently match this filter.</p>
      </div>`;
    return;
  }

  tableWrap.innerHTML = `
    <table class="req-table">
      <thead><tr>
        <th>Reference</th><th>Student</th><th>Document</th><th>Fee</th><th>Submitted</th><th>Status</th><th></th>
      </tr></thead>
      <tbody>
        ${filtered.map(r=>`
          <tr onclick="openDetailModal('${r.id}')">
            <td class="ref">${r.id}</td>
            <td><div class="student-name">${escapeHtml(r.studentName)}</div><div class="student-id">${escapeHtml(r.studentId)}</div></td>
            <td>${escapeHtml(r.documentTypeName)}</td>
            <td>&#8369;${r.fee}</td>
            <td>${fmtDate(r.createdAt)}</td>
            <td><span class="badge ${statusBadgeClass(r.status)}"><span class="badge-dot"></span>${r.status}</span></td>
            <td>${r.status!==STATUS.REJECTED && r.status!==STATUS.DONE ? `<button class="btn btn-outline btn-sm" onclick="event.stopPropagation(); quickReject('${r.id}')">Reject</button>` : ''}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

async function quickReject(reqId){
  const reason = window.prompt('Reason for rejecting this request:');
  if(reason===null) return; // cancelled
  const trimmed = reason.trim();
  if(!trimmed){ alert('A rejection reason is required.'); return; }
  const all = await getAllRequests();
  const r = all.find(x=>x.id===reqId);
  if(!r) return;
  r.status = STATUS.REJECTED;
  r.rejectReason = trimmed;
  r.updatedAt = Date.now();
  await saveRequest(r);
  await renderAdminPage();
}

function setAdminFilter(key){
  activeAdminFilter = key;
  renderAdminPage();
}

/* ---- Student accounts (admin view) ---- */
async function renderAdminStudentsView(){
  const allUsers = await getAllUsers();
  const students = allUsers.filter(u=>u.role==='student');
  const allRequests = await getAllRequests();
  const wrap = document.getElementById('admin-students-view');

  if(students.length===0){
    wrap.innerHTML = `
      <div class="empty-state">
        <div class="glyph">&#128101;</div>
        <h3>No student accounts yet</h3>
        <p>Registered students will appear here once they sign up.</p>
      </div>`;
    return;
  }

  wrap.innerHTML = `
    <table class="req-table">
      <thead><tr>
        <th></th><th>Name</th><th>Student ID</th><th>Username</th><th>Email</th><th>Phone</th><th>Requests</th>
      </tr></thead>
      <tbody>
        ${students.map(s=>{
          const count = allRequests.filter(r=>r.studentUsername===s.username).length;
          return `
          <tr onclick="openStudentDetailModal('${s.username}')">
            <td><div class="avatar-circle" style="width:34px; height:34px; font-size:12px;">${avatarInnerHtml(s)}</div></td>
            <td class="student-name">${escapeHtml(s.name)}</td>
            <td class="ref">${escapeHtml(s.studentId||'\u2014')}</td>
            <td class="ref">${escapeHtml(s.username)}</td>
            <td>${escapeHtml(s.email||'\u2014')}</td>
            <td>${escapeHtml(s.phone||'\u2014')}</td>
            <td>${count}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

async function openStudentDetailModal(username){
  const s = await getUser(username);
  if(!s) return;
  const allRequests = await getAllRequests();
  const mine = allRequests.filter(r=>r.studentUsername===username);
  const counts = {};
  mine.forEach(r=>{ counts[r.status] = (counts[r.status]||0) + 1; });

  document.getElementById('modal-root').innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this) closeModal()">
      <div class="modal">
        <div class="modal-head">
          <div style="display:flex; align-items:center; gap:14px;">
            <div class="avatar-circle" style="width:48px; height:48px; font-size:16px; flex-shrink:0;">${avatarInnerHtml(s)}</div>
            <h2>${escapeHtml(s.name)}</h2>
          </div>
          <button class="modal-close" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
          <p class="subline">Student account</p>
          <div class="detail-grid">
            <div><div class="k">Student ID</div><div class="v mono">${escapeHtml(s.studentId||'\u2014')}</div></div>
            <div><div class="k">Username</div><div class="v mono">${escapeHtml(s.username)}</div></div>
            <div><div class="k">Email</div><div class="v">${escapeHtml(s.email||'\u2014')}</div></div>
            <div><div class="k">Phone</div><div class="v">${escapeHtml(s.phone||'\u2014')}</div></div>
          </div>
          <div class="k" style="margin-bottom:8px;">Requests submitted</div>
          <div style="display:flex; flex-wrap:wrap; gap:8px;">
            ${mine.length===0
              ? `<span class="hint">No requests submitted yet.</span>`
              : Object.entries(counts).map(([status,c])=>`<span class="badge ${statusBadgeClass(status)}"><span class="badge-dot"></span>${escapeHtml(status)}: ${c}</span>`).join('')
            }
          </div>
        </div>
      </div>
    </div>`;
}

async function openDetailModal(reqId){
  const all = await getAllRequests();
  const r = all.find(x=>x.id===reqId);
  if(!r) return;

  const isImg = r.proofType && r.proofType.startsWith('image/');
  const proofHtml = isImg
    ? `<div class="proof-preview"><img src="${r.proofDataUrl}" alt="Payment proof"></div>`
    : `<div class="proof-preview"><a class="pdf-link" href="${r.proofDataUrl}" download="${escapeHtml(r.proofFileName)}"><span class="icon">PDF</span><span>${escapeHtml(r.proofFileName)} &mdash; click to download</span></a></div>`;

  let actionsHtml = '';
  if(r.status===STATUS.PENDING){
    actionsHtml = `
      <div class="action-row">
        <button class="btn btn-brass" onclick="advanceStatus('${r.id}','${STATUS.PROCESSING}')">Verify payment &rarr; Processing</button>
        <button class="btn btn-outline" onclick="toggleRejectPanel()">Reject</button>
      </div>
      <div id="reject-panel" class="reject-panel hidden">
        <div class="field"><label>Reason for rejection</label><textarea id="reject-reason" placeholder="e.g. Invalid payment proof, amount does not match fee"></textarea></div>
        <button class="btn btn-red btn-sm" onclick="rejectRequest('${r.id}')">Confirm rejection</button>
      </div>`;
  } else if(r.status===STATUS.PROCESSING){
    actionsHtml = `
      <div class="action-row">
        <button class="btn btn-brass" onclick="advanceStatus('${r.id}','${STATUS.READY}')">Mark ready for pickup</button>
        <button class="btn btn-outline" onclick="toggleRejectPanel()">Reject</button>
      </div>
      <div id="reject-panel" class="reject-panel hidden">
        <div class="field"><label>Reason for rejection</label><textarea id="reject-reason" placeholder="e.g. Missing student records"></textarea></div>
        <button class="btn btn-red btn-sm" onclick="rejectRequest('${r.id}')">Confirm rejection</button>
      </div>`;
  } else if(r.status===STATUS.READY){
    actionsHtml = `
      <div class="action-row">
        <button class="btn btn-brass" onclick="advanceStatus('${r.id}','${STATUS.DONE}')">Mark as claimed &rarr; Completed</button>
        <button class="btn btn-outline" onclick="toggleRejectPanel()">Reject</button>
      </div>
      <div class="hint" style="margin-top:10px;">Confirm "claimed" once the student has picked up the physical document.</div>
      <div id="reject-panel" class="reject-panel hidden">
        <div class="field"><label>Reason for rejection</label><textarea id="reject-reason" placeholder="e.g. Document was never picked up, request voided"></textarea></div>
        <button class="btn btn-red btn-sm" onclick="rejectRequest('${r.id}')">Confirm rejection</button>
      </div>`;
  } else if(r.status===STATUS.DONE){
    actionsHtml = `<div class="hint">This request has been claimed by the student. No further action needed.</div>`;
  } else if(r.status===STATUS.REJECTED){
    actionsHtml = `<div class="reject-reason" style="margin-top:4px;"><b>Rejection reason:</b> ${escapeHtml(r.rejectReason || 'No reason provided.')}</div>`;
  }

  document.getElementById('modal-root').innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this) closeModal()">
      <div class="modal">
        <div class="modal-head">
          <h2>${escapeHtml(r.documentTypeName)}</h2>
          <button class="modal-close" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
          <p class="subline">Reference ${r.id}</p>
          <div class="detail-grid">
            <div><div class="k">Student</div><div class="v">${escapeHtml(r.studentName)}</div></div>
            <div><div class="k">Student ID</div><div class="v mono">${escapeHtml(r.studentId)}</div></div>
            <div><div class="k">Fee</div><div class="v">&#8369;${r.fee}</div></div>
            <div><div class="k">Status</div><div class="v"><span class="badge ${statusBadgeClass(r.status)}"><span class="badge-dot"></span>${r.status}</span></div></div>
            <div><div class="k">Submitted</div><div class="v">${fmtDate(r.createdAt)}</div></div>
            <div><div class="k">Last updated</div><div class="v">${fmtDate(r.updatedAt)}</div></div>
          </div>
          <div class="k" style="margin-bottom:8px;">Proof of payment</div>
          ${proofHtml}
          ${actionsHtml}
        </div>
      </div>
    </div>`;
}

function toggleRejectPanel(){
  document.getElementById('reject-panel').classList.toggle('hidden');
}

async function advanceStatus(reqId, newStatus){
  const all = await getAllRequests();
  const r = all.find(x=>x.id===reqId);
  if(!r) return;
  r.status = newStatus;
  r.updatedAt = Date.now();
  await saveRequest(r);
  closeModal();
  await renderAdminPage();
}

async function rejectRequest(reqId){
  const reasonEl = document.getElementById('reject-reason');
  const reason = reasonEl ? reasonEl.value.trim() : '';
  if(!reason){ reasonEl.focus(); reasonEl.style.borderColor='var(--red)'; return; }
  const all = await getAllRequests();
  const r = all.find(x=>x.id===reqId);
  if(!r) return;
  r.status = STATUS.REJECTED;
  r.rejectReason = reason;
  r.updatedAt = Date.now();
  await saveRequest(r);
  closeModal();
  await renderAdminPage();
}

function closeModal(){
  document.getElementById('modal-root').innerHTML = '';
}

/* =====================================================================
   INIT
===================================================================== */
(async function init(){
  try{ await ensureSeedAdmin(); }catch(e){ console.error('Seed admin failed', e); }
})();
