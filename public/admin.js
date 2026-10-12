// Admin Web Control Center Logic
let token = localStorage.getItem('us_token');
let user = null;
let departmentsList = [];
let teamLeadersList = [];
let employeesList = [];

let staffDeptFilter = '';
let staffSearchQuery = '';

let attDeptFilter = '';
let attSelectedMonth = new Date().toISOString().slice(0, 7);

let leaveDeptFilter = '';
let leaveStatusTab = 'AWAITING_HR';
let allLeavesData = [];

let selectedLeaveForDecision = null;
let leaveDecisionAction = 'APPROVED';

window.addEventListener('DOMContentLoaded', async () => {
  // 1. Session verification
  if (!token) {
    window.location.href = 'index.html';
    return;
  }

  try {
    user = JSON.parse(localStorage.getItem('us_user'));
    if (!user || (user.role !== 'ADMIN' && user.role !== 'HR_ADMIN')) {
      alert('Access Denied: Only administrators have access to this portal.');
      handleLogout();
      return;
    }
  } catch (e) {
    handleLogout();
    return;
  }

  document.getElementById('adminUserName').innerText = user.full_name || 'Administrator';
  document.getElementById('adminUserEmail').innerText = user.email || 'admin@unitedsoft.com';

  // Set default months
  document.getElementById('attMonthInput').value = attSelectedMonth;
  document.getElementById('payrollMonthPicker').value = attSelectedMonth;
  document.getElementById('outsideDate').value = new Date().toISOString().split('T')[0];

  await loadMetadata();
  await loadDashboardData();
});

function handleLogout() {
  localStorage.removeItem('us_token');
  localStorage.removeItem('us_user');
  window.location.href = 'index.html';
}

async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    ...(options.headers || {})
  };

  const res = await fetch(`/api${path}`, { ...options, headers });
  if (res.status === 401 || res.status === 403) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      alert('Session expired. Please log in again.');
      handleLogout();
      throw new Error('Unauthorized');
    }
    throw new Error(data.error || 'Access Denied');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

// ================= NAVIGATION =================
function switchNav(secId, btnElement) {
  document.querySelectorAll('.content-sec').forEach(sec => sec.style.display = 'none');
  document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));

  document.getElementById(`sec-${secId}`).style.display = 'block';
  btnElement.classList.add('active');

  if (secId === 'dashboard') loadDashboardData();
  else if (secId === 'staff') loadStaffDirectory();
  else if (secId === 'attendance') { loadAttendance(); loadOutsideShiftEntries(); }
  else if (secId === 'leaves') loadLeaves();
  else if (secId === 'payroll') loadPayrollRecords();
  else if (secId === 'geofence') loadGeofenceAndWifi();
  else if (secId === 'security') loadSecurityLogs();
}

// ================= METADATA =================
async function loadMetadata() {
  try {
    const [deptRes, tlRes, colRes] = await Promise.all([
      api('/departments'),
      api('/team-leaders'),
      api('/outside-shift/colleges').catch(() => ({ colleges: [] }))
    ]);

    departmentsList = deptRes.departments || [];
    teamLeadersList = tlRes.teamLeaders || tlRes.team_leaders || [];

    // Render department chips
    renderDeptChips('staffDeptChipsRow', departmentsList, setStaffDeptFilter);
    renderDeptChips('attDeptChipsRow', departmentsList, setAttDeptFilter);
    renderDeptChips('leaveDeptChipsRow', departmentsList, setLeaveDeptFilter);

    // Populate colleges
    const colSelect = document.getElementById('outsideCollegeSelect');
    colSelect.innerHTML = (colRes.colleges || []).map(c => `<option value="${c}">${c}</option>`).join('');
    colSelect.innerHTML += `<option value="CUSTOM">-- Enter Other College / Venue --</option>`;

    // Populate TL dropdown
    const tlSelect = document.getElementById('addStaffTL');
    tlSelect.innerHTML = '<option value="">None / Direct</option>' +
      teamLeadersList.map(t => `<option value="${t.id}">${t.full_name} (${t.department})</option>`).join('');

  } catch (err) {
    console.warn('Metadata loading warning', err);
  }
}

function renderDeptChips(containerId, depts, clickFn) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = `<div class="chip active-teal" onclick="${clickFn.name}('')">All Departments</div>`;
  depts.forEach(d => {
    container.innerHTML += `<div class="chip" onclick="${clickFn.name}('${d}', this)">${d}</div>`;
  });
}

// ================= DASHBOARD =================
async function loadDashboardData() {
  try {
    const [empRes, attRes, leaveRes, netRes] = await Promise.all([
      api('/employees'),
      api('/attendance/all'),
      api('/leaves/all?status=PENDING'),
      api('/settings/network').catch(() => ({ settings: { wifi_validation_enabled: false } }))
    ]);

    employeesList = empRes.employees || [];
    document.getElementById('statTotalStaff').innerText = employeesList.length;

    const todayStr = new Date().toISOString().split('T')[0];
    const todayPunches = (attRes.attendance || []).filter(a => a.date === todayStr);
    document.getElementById('statPresentToday').innerText = todayPunches.length;

    const pendingLeaves = leaveRes.leaves || [];
    document.getElementById('statPendingLeaves').innerText = pendingLeaves.length;
    const badge = document.getElementById('pendingLeaveBadge');
    if (pendingLeaves.length > 0) {
      badge.style.display = 'inline-block';
      badge.innerText = pendingLeaves.length;
    } else {
      badge.style.display = 'none';
    }

    const wifiEnabled = Boolean(netRes.settings && netRes.settings.wifi_validation_enabled);
    document.getElementById('statWifiStatus').innerText = wifiEnabled ? 'ENFORCED' : 'OPTIONAL';
    document.getElementById('statWifiStatus').style.color = wifiEnabled ? 'var(--secondary)' : 'var(--text-muted)';

    // Dashboard live table
    const dashTbody = document.getElementById('dashAttendanceTbody');
    if (todayPunches.length === 0) {
      dashTbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No attendance records recorded yet for today.</td></tr>`;
    } else {
      dashTbody.innerHTML = todayPunches.slice(0, 8).map(item => `
        <tr>
          <td><strong>${item.full_name || 'Staff'}</strong><br><small style="color: var(--text-muted);">${item.employee_code || ''}</small></td>
          <td>${item.department || '--'}</td>
          <td>${item.check_in_time ? new Date(item.check_in_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}</td>
          <td><span class="status-pill ${item.status === 'PRESENT' ? 'pill-success' : 'pill-warning'}">${item.status}</span></td>
          <td>${item.verification_method || 'DIGITAL_GPS'}</td>
          <td>${Math.round(item.distance_meters || 0)}m from office</td>
        </tr>
      `).join('');
    }

  } catch (err) {
    console.error('Error loading dashboard', err);
  }
}

// ================= STAFF DIRECTORY =================
async function loadStaffDirectory() {
  try {
    const q = new URLSearchParams();
    if (staffSearchQuery) q.append('search', staffSearchQuery);
    if (staffDeptFilter) q.append('department', staffDeptFilter);

    const res = await api(`/employees?${q.toString()}`);
    employeesList = res.employees || [];
    renderStaffTable();

    // Also populate outside shift select
    const outSelect = document.getElementById('outsideStaffSelect');
    if (outSelect) {
      outSelect.innerHTML = employeesList.map(e => `<option value="${e.id}">${e.full_name} (${e.employee_code} • ${e.department})</option>`).join('');
    }
  } catch (err) {
    alert(err.message);
  }
}

function setStaffDeptFilter(dept, element) {
  staffDeptFilter = dept;
  const container = document.getElementById('staffDeptChipsRow');
  container.querySelectorAll('.chip').forEach(c => c.classList.remove('active-teal'));
  if (element) element.classList.add('active-teal');
  else container.querySelector('.chip').classList.add('active-teal');
  loadStaffDirectory();
}

function handleStaffSearch() {
  staffSearchQuery = document.getElementById('staffSearchInput').value.trim();
  loadStaffDirectory();
}

function renderStaffTable() {
  const tbody = document.getElementById('staffTbody');
  if (employeesList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 30px; color: var(--text-muted);">No employees found matching filter criteria.</td></tr>`;
    return;
  }

  tbody.innerHTML = employeesList.map(emp => {
    const isBound = Boolean(emp.device_registered);
    const rolePill = emp.role === 'ADMIN' || emp.role === 'HR_ADMIN' ? 'pill-info' : emp.role === 'TL' ? 'pill-warning' : 'pill-success';

    return `
      <tr>
        <td>
          <div style="font-weight: 700; color: var(--text-main);">${emp.full_name}</div>
          <div style="font-size: 11.5px; color: var(--text-muted);">${emp.employee_code} • ${emp.email}</div>
        </td>
        <td>
          <span class="status-pill ${rolePill}">${emp.role === 'TL' ? 'Team Lead (TL)' : emp.role}</span>
        </td>
        <td>
          <div style="font-weight: 600;">${emp.designation || '--'}</div>
          <div style="font-size: 11.5px; color: var(--text-muted);">${emp.department || '--'}</div>
        </td>
        <td>₹${(emp.base_salary || 0).toLocaleString('en-IN')}</td>
        <td>
          ${isBound
            ? `<span class="status-pill pill-success"><i class="fa-solid fa-lock"></i> Device Bound</span>`
            : `<span class="status-pill pill-warning"><i class="fa-solid fa-unlock"></i> Unbound (Ready)</span>`
          }
          <div style="font-size: 10.5px; color: var(--text-muted); margin-top: 2px;">SIM: ${emp.phone || 'Not Registered'}</div>
        </td>
        <td>
          <div style="display: flex; gap: 6px;">
            ${isBound ? `
              <button class="btn btn-outline btn-sm" onclick="handleResetDevice('${emp.id}', '${emp.full_name}')" title="Reset bound hardware ID">
                <i class="fa-solid fa-rotate-left" style="color: var(--danger);"></i> Reset Device
              </button>
            ` : ''}
            <button class="btn btn-outline btn-sm" onclick="handleGeneratePin('${emp.id}', '${emp.full_name}')" title="Generate emergency 6-digit PIN">
              <i class="fa-solid fa-key" style="color: var(--primary);"></i> PIN
            </button>
            ${emp.role !== 'HR_ADMIN' && emp.role !== 'ADMIN' ? `
              <button class="btn btn-outline btn-sm" onclick="handleDeleteStaff('${emp.id}', '${emp.full_name}')" title="Delete employee account">
                <i class="fa-solid fa-trash" style="color: var(--danger);"></i>
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function openAddStaffModal() {
  document.getElementById('modalAddStaff').classList.add('open');
}

async function handleCreateStaff(e) {
  e.preventDefault();
  const name = document.getElementById('addStaffName').value.trim();
  const email = document.getElementById('addStaffEmail').value.trim();
  const pass = document.getElementById('addStaffPassword').value;
  const dept = document.getElementById('addStaffDept').value.trim();
  const desig = document.getElementById('addStaffDesig').value.trim();
  const role = document.getElementById('addStaffRole').value;
  const phone = document.getElementById('addStaffPhone').value.trim();
  const tlId = document.getElementById('addStaffTL').value;
  const salary = parseFloat(document.getElementById('addStaffSalary').value) || 0;

  try {
    await api('/employees', {
      method: 'POST',
      body: JSON.stringify({
        full_name: name,
        email: email,
        password: pass,
        department: dept,
        designation: desig,
        role: role,
        phone: phone,
        team_leader_id: tlId || undefined,
        base_salary: salary
      })
    });
    alert('Staff member onboarded successfully!');
    closeModal('modalAddStaff');
    await loadStaffDirectory();
    await loadMetadata();
  } catch (err) {
    alert(err.message);
  }
}

async function handleResetDevice(empId, name) {
  if (!confirm(`Reset registered device binding for ${name}?\n\nThis will unbind their phone and allow them to register their new device upon next login.`)) return;
  try {
    await api(`/employees/${empId}`, {
      method: 'PUT',
      body: JSON.stringify({ resetDevice: true })
    });
    alert('Device binding successfully reset!');
    await loadStaffDirectory();
  } catch (err) {
    alert(err.message);
  }
}

async function handleGeneratePin(empId, name) {
  try {
    const res = await api(`/employees/${empId}/generate-pin`, { method: 'POST' });
    alert(`Emergency Verification PIN for ${name}:\n\nPIN: ${res.verificationCode || res.code}\n\nValid for 15 minutes. Provide this to the employee to authorize login.`);
  } catch (err) {
    alert(err.message);
  }
}

async function handleDeleteStaff(empId, name) {
  if (!confirm(`Are you sure you want to delete ${name}'s account? This action cannot be undone.`)) return;
  try {
    await api(`/employees/${empId}`, { method: 'DELETE' });
    alert('Staff account deleted successfully.');
    await loadStaffDirectory();
  } catch (err) {
    alert(err.message);
  }
}

// ================= ATTENDANCE OVERSIGHT =================
async function loadAttendance() {
  try {
    const q = new URLSearchParams();
    if (attDeptFilter) q.append('department', attDeptFilter);
    if (attSelectedMonth) q.append('month', attSelectedMonth);

    const res = await api(`/attendance/all?${q.toString()}`);
    const list = res.attendance || [];
    const tbody = document.getElementById('attendanceTbody');

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 25px; color: var(--text-muted);">No attendance records found for ${attSelectedMonth}.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(item => `
      <tr>
        <td>
          <div style="font-weight: 700;">${item.full_name || 'Staff'}</div>
          <div style="font-size: 11px; color: var(--text-muted);">${item.employee_code} • ${item.department}</div>
        </td>
        <td>${item.date}</td>
        <td>${item.check_in_time ? new Date(item.check_in_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}</td>
        <td>${item.check_out_time ? new Date(item.check_out_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}</td>
        <td><strong>${item.working_hours || 0} hrs</strong></td>
        <td><span class="status-pill ${item.status === 'PRESENT' ? 'pill-success' : 'pill-warning'}">${item.status}</span></td>
        <td>${Math.round(item.distance_meters || 0)}m</td>
        <td>
          <div style="font-size: 11.5px; color: var(--text-muted);">${item.verification_method || 'GPS'}</div>
          ${item.remarks ? `<div style="font-size: 11px; color: #475569; font-style: italic;">"${item.remarks}"</div>` : ''}
        </td>
      </tr>
    `).join('');
  } catch (err) {
    alert(err.message);
  }
}

function setAttDeptFilter(dept, element) {
  attDeptFilter = dept;
  const container = document.getElementById('attDeptChipsRow');
  container.querySelectorAll('.chip').forEach(c => c.classList.remove('active-teal'));
  if (element) element.classList.add('active-teal');
  else container.querySelector('.chip').classList.add('active-teal');
  loadAttendance();
}

function handleAttMonthChange() {
  attSelectedMonth = document.getElementById('attMonthInput').value;
  loadAttendance();
}

async function loadOutsideShiftEntries() {
  try {
    const res = await api('/outside-shift/entries');
    const tbody = document.getElementById('outsideShiftTbody');
    const list = res.entries || [];

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 20px; color: var(--text-muted);">No outside-shift entries recorded.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(item => `
      <tr>
        <td><strong>${item.staff_name}</strong><br><small style="color: var(--text-muted);">${item.employee_code || ''}</small></td>
        <td>${item.department || '--'}</td>
        <td><span style="font-weight: 700; color: var(--secondary);">${item.college_name}</span></td>
        <td>${item.date}</td>
        <td>${item.start_time || '09:30 AM'} → ${item.end_time || '05:30 PM'}</td>
        <td>${item.work_description || item.purpose || 'External Assignment'}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.warn('Error loading outside-shift', err);
  }
}

function openOutsideShiftModal() {
  document.getElementById('modalOutsideShift').classList.add('open');
}

function toggleCustomCollege(val) {
  const custom = document.getElementById('outsideCollegeCustom');
  if (val === 'CUSTOM') {
    custom.style.display = 'block';
    custom.focus();
  } else {
    custom.style.display = 'none';
  }
}

async function handleSaveOutsideShift(e) {
  e.preventDefault();
  const staffSelect = document.getElementById('outsideStaffSelect');
  const userId = staffSelect.value;
  const emp = employeesList.find(e => e.id === userId);

  const colSelect = document.getElementById('outsideCollegeSelect');
  const customCol = document.getElementById('outsideCollegeCustom').value.trim();
  const collegeName = colSelect.value === 'CUSTOM' ? customCol : (customCol || colSelect.value);

  if (!collegeName) {
    alert('Please enter or select a College Name');
    return;
  }

  const date = document.getElementById('outsideDate').value;
  const timing = document.getElementById('outsideTiming').value;
  const purpose = document.getElementById('outsidePurpose').value;

  try {
    await api('/outside-shift/entries', {
      method: 'POST',
      body: JSON.stringify({
        user_id: userId,
        staff_name: emp ? emp.full_name : 'Staff',
        department: emp ? emp.department : 'General',
        college_name: collegeName,
        date: date,
        start_time: timing.split('-')[0]?.trim() || '09:30 AM',
        end_time: timing.split('-')[1]?.trim() || '05:30 PM',
        work_description: purpose,
        purpose: purpose
      })
    });
    alert('Outside-shift entry successfully recorded!');
    closeModal('modalOutsideShift');
    loadOutsideShiftEntries();
    loadAttendance();
  } catch (err) {
    alert(err.message);
  }
}

function openManualPunchModal() {
  const staffName = prompt('Enter Employee Code or Name for Manual Attendance:');
  if (!staffName) return;
  const emp = employeesList.find(e => e.employee_code.toLowerCase() === staffName.toLowerCase() || e.full_name.toLowerCase().includes(staffName.toLowerCase()));
  if (!emp) {
    alert('Employee not found with specified code or name.');
    return;
  }
  const status = prompt('Enter Status (PRESENT, LATE, HALF_DAY):', 'PRESENT');
  if (!status) return;

  api('/attendance/manual-entry', {
    method: 'POST',
    body: JSON.stringify({
      user_id: emp.id,
      date: new Date().toISOString().split('T')[0],
      status: status.toUpperCase(),
      remarks: 'Admin Manual Override'
    })
  }).then(() => {
    alert('Manual attendance entry saved!');
    loadAttendance();
  }).catch(err => alert(err.message));
}

// ================= LEAVE APPROVALS =================
async function loadLeaves() {
  try {
    const q = new URLSearchParams();
    if (leaveDeptFilter) q.append('department', leaveDeptFilter);

    const res = await api(`/leaves/all?${q.toString()}`);
    allLeavesData = res.leaves || [];
    renderLeavesList();
  } catch (err) {
    alert(err.message);
  }
}

function setLeaveDeptFilter(dept, element) {
  leaveDeptFilter = dept;
  const container = document.getElementById('leaveDeptChipsRow');
  container.querySelectorAll('.chip').forEach(c => c.classList.remove('active-teal'));
  if (element) element.classList.add('active-teal');
  else container.querySelector('.chip').classList.add('active-teal');
  loadLeaves();
}

function setLeaveStatusTab(tab, element) {
  leaveStatusTab = tab;
  element.parentElement.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  element.classList.add('active');
  renderLeavesList();
}

function renderLeavesList() {
  const container = document.getElementById('leavesContainer');
  const awaitingCount = allLeavesData.filter(l => l.status === 'TL_APPROVED' || (l.status === 'PENDING' && !l.tl_id)).length;

  const countBadge = document.getElementById('leaveTabCountBadge');
  if (awaitingCount > 0) {
    countBadge.style.display = 'inline-block';
    countBadge.innerText = awaitingCount;
  } else {
    countBadge.style.display = 'none';
  }

  const filtered = allLeavesData.filter(lv => {
    if (leaveStatusTab === 'AWAITING_HR') return lv.status === 'TL_APPROVED' || (lv.status === 'PENDING' && !lv.tl_id);
    if (leaveStatusTab === 'PENDING_TL') return lv.status === 'PENDING' && Boolean(lv.tl_id);
    if (leaveStatusTab === 'APPROVED') return lv.status === 'APPROVED';
    if (leaveStatusTab === 'REJECTED') return lv.status === 'REJECTED';
    return true; // ALL
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div class="card" style="text-align: center; padding: 40px; color: var(--text-muted);">No leave requests matching the active filter.</div>`;
    return;
  }

  container.innerHTML = filtered.map(lv => {
    const isPendingDecision = lv.status === 'TL_APPROVED' || lv.status === 'PENDING';
    const tlApproved = lv.status === 'TL_APPROVED' || lv.status === 'APPROVED' || Boolean(lv.tl_approved_at);
    const tlRejected = lv.status === 'REJECTED' && !lv.hr_approved_at && Boolean(lv.tl_remarks);
    const hrApproved = lv.status === 'APPROVED';
    const hrRejected = lv.status === 'REJECTED' && Boolean(lv.hr_remarks);

    return `
      <div class="card" style="margin-bottom: 14px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
          <div>
            <div style="font-size: 15px; font-weight: 800; color: var(--text-main);">${lv.full_name || 'Staff'}</div>
            <div style="font-size: 12px; color: var(--text-muted);">${lv.employee_code} • ${lv.department}</div>
          </div>
          <span class="status-pill ${lv.status === 'APPROVED' ? 'pill-success' : lv.status === 'REJECTED' ? 'pill-danger' : 'pill-warning'}">
            ${lv.status === 'TL_APPROVED' ? 'AWAITING HR' : lv.status}
          </span>
        </div>

        <div style="background: #F8FAFC; padding: 10px 14px; border-radius: var(--radius-md); display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 12.5px;">
          <div><strong style="color: var(--primary);">${lv.leave_type} LEAVE</strong> (${lv.total_days} ${lv.total_days === 1 ? 'day' : 'days'})</div>
          <div><i class="fa-regular fa-calendar"></i> ${lv.start_date} → ${lv.end_date}</div>
        </div>

        <div style="font-size: 13px; color: var(--text-muted); font-style: italic; margin-bottom: 12px;">
          Reason: "${lv.reason}"
        </div>

        <!-- 3-Step Approval Visual Timeline -->
        <div class="timeline-wrap">
          <div class="timeline-step">
            <div class="step-bubble bubble-done"><i class="fa-solid fa-check"></i></div>
            <div class="step-name">Requested</div>
            <div class="step-state" style="color: #059669; font-weight: 700;">Submitted</div>
          </div>

          <div class="timeline-connector ${tlApproved || tlRejected ? 'active' : ''}"></div>

          <div class="timeline-step">
            <div class="step-bubble ${tlApproved ? 'bubble-done' : tlRejected ? 'bubble-rejected' : 'bubble-pending'}">
              <i class="fa-solid ${tlApproved ? 'fa-check' : tlRejected ? 'fa-xmark' : 'fa-hourglass'}"></i>
            </div>
            <div class="step-name">TL Approval</div>
            <div class="step-state" style="font-weight: 700; color: ${tlApproved ? '#059669' : tlRejected ? '#DC2626' : '#D97706'};">
              ${tlApproved ? 'Approved' : tlRejected ? 'Rejected' : 'Pending'}
            </div>
          </div>

          <div class="timeline-connector ${hrApproved || hrRejected ? 'active' : ''}"></div>

          <div class="timeline-step">
            <div class="step-bubble ${hrApproved ? 'bubble-done' : hrRejected ? 'bubble-rejected' : 'bubble-pending'}">
              <i class="fa-solid ${hrApproved ? 'fa-check' : hrRejected ? 'fa-xmark' : 'fa-hourglass'}"></i>
            </div>
            <div class="step-name">HR Approval</div>
            <div class="step-state" style="font-weight: 700; color: ${hrApproved ? '#059669' : hrRejected ? '#DC2626' : '#D97706'};">
              ${hrApproved ? 'Approved' : hrRejected ? 'Rejected' : 'Pending'}
            </div>
          </div>
        </div>

        ${lv.tl_remarks ? `
          <div style="background: #F0FDFA; border: 1px solid #CCFBF1; border-radius: var(--radius-sm); padding: 8px 12px; margin-top: 8px; font-size: 12px; color: #0F766E;">
            <strong>TL Remarks (${lv.tl_name || 'Team Leader'}):</strong> ${lv.tl_remarks}
          </div>
        ` : ''}

        ${lv.hr_remarks || lv.comments ? `
          <div style="background: #F0FDF4; border: 1px solid #BBF7D0; border-radius: var(--radius-sm); padding: 8px 12px; margin-top: 8px; font-size: 12px; color: #166534;">
            <strong>HR Remarks (${lv.hr_name || lv.approver_name || 'Admin'}):</strong> ${lv.hr_remarks || lv.comments}
          </div>
        ` : ''}

        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--border);">
          <button class="btn btn-outline btn-sm" onclick="openAuditTrail('${lv.id}', '${lv.full_name}')">
            <i class="fa-solid fa-receipt"></i> View Audit Trail
          </button>

          ${isPendingDecision ? `
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-danger btn-sm" onclick="openLeaveDecisionModal('${lv.id}', 'REJECTED')">
                <i class="fa-solid fa-xmark"></i> Decline
              </button>
              <button class="btn btn-primary btn-sm" onclick="openLeaveDecisionModal('${lv.id}', 'APPROVED')">
                <i class="fa-solid fa-check"></i> Approve
              </button>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function openLeaveDecisionModal(leaveId, action) {
  selectedLeaveForDecision = allLeavesData.find(l => l.id === leaveId);
  if (!selectedLeaveForDecision) return;
  leaveDecisionAction = action;

  document.getElementById('leaveDecisionTitle').innerText = action === 'APPROVED' ? 'Approve Leave Request' : 'Decline Leave Request';
  document.getElementById('leaveDecisionDetails').innerHTML = `
    Applicant: <strong>${selectedLeaveForDecision.full_name}</strong> • ${selectedLeaveForDecision.department}<br>
    Duration: ${selectedLeaveForDecision.total_days} days (${selectedLeaveForDecision.start_date} → ${selectedLeaveForDecision.end_date})
  `;
  document.getElementById('leaveDecisionRemarks').value = action === 'APPROVED' ? 'Approved by Administrator' : 'Declined due to ongoing project delivery schedule';

  const confirmBtn = document.getElementById('btnConfirmLeaveDecision');
  confirmBtn.className = action === 'APPROVED' ? 'btn btn-primary' : 'btn btn-danger';
  confirmBtn.innerText = action === 'APPROVED' ? 'Confirm Approval' : 'Confirm Decline';

  document.getElementById('modalLeaveDecision').classList.add('open');
}

async function confirmLeaveDecision() {
  if (!selectedLeaveForDecision) return;
  const remarks = document.getElementById('leaveDecisionRemarks').value.trim();

  try {
    await api(`/leaves/${selectedLeaveForDecision.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: leaveDecisionAction,
        comments: remarks
      })
    });
    alert(`Leave request has been ${leaveDecisionAction.toLowerCase()}!`);
    closeModal('modalLeaveDecision');
    loadLeaves();
  } catch (err) {
    alert(err.message);
  }
}

async function openAuditTrail(leaveId, empName) {
  const container = document.getElementById('auditTrailLogsList');
  container.innerHTML = '<div style="text-align: center; padding: 20px;">Fetching logs...</div>';
  document.getElementById('modalAuditTrail').classList.add('open');

  try {
    const res = await api(`/leaves/${leaveId}/history`);
    const logs = res.logs || [];

    if (logs.length === 0) {
      container.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-muted);">No history logs recorded for this leave.</div>';
      return;
    }

    container.innerHTML = logs.map(l => `
      <div style="background: #F8FAFC; border: 1px solid var(--border); border-radius: var(--radius-md); padding: 10px 14px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <span class="status-pill pill-info">${l.action}</span>
          <span style="font-size: 11px; color: var(--text-muted);">${new Date(l.created_at).toLocaleString('en-IN')}</span>
        </div>
        <div style="font-size: 12.5px; font-weight: 700; color: var(--text-main);">By: ${l.actor_name || 'System'} (${l.actor_role || 'STAFF'})</div>
        ${l.remarks ? `<div style="font-size: 12px; color: #475569; font-style: italic; margin-top: 4px;">"${l.remarks}"</div>` : ''}
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `<div style="color: var(--danger); padding: 15px;">Failed to load audit trail: ${err.message}</div>`;
  }
}

// ================= AUTOMATED PAYROLL =================
async function loadPayrollRecords() {
  const m = document.getElementById('payrollMonthPicker').value;
  try {
    const res = await api(`/payroll/records?month_year=${m}`);
    const list = res.records || [];
    const tbody = document.getElementById('payrollTbody');

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 25px; color: var(--text-muted);">No payroll generated yet for ${m}. Click "Run Payroll" to compute.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(item => `
      <tr>
        <td><strong>${item.full_name}</strong><br><small style="color: var(--text-muted);">${item.employee_code}</small></td>
        <td>${item.department}</td>
        <td>₹${item.base_salary.toLocaleString('en-IN')}</td>
        <td>₹${(item.hra + item.allowances).toLocaleString('en-IN')}</td>
        <td style="color: var(--danger);">-₹${item.lop_deduction.toLocaleString('en-IN')}</td>
        <td>-₹${(item.pf_deduction + item.tax_deduction).toLocaleString('en-IN')}</td>
        <td><strong style="color: var(--primary);">₹${item.net_salary.toLocaleString('en-IN')}</strong></td>
        <td><span class="status-pill ${item.status === 'PAID' ? 'pill-success' : 'pill-warning'}">${item.status}</span></td>
        <td>
          <button class="btn btn-outline btn-sm" onclick="downloadPayslip('${item.id}')" title="Download compliant PDF Payslip">
            <i class="fa-solid fa-file-pdf" style="color: var(--danger);"></i> PDF Slip
          </button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    alert(err.message);
  }
}

async function handleGeneratePayroll() {
  const m = document.getElementById('payrollMonthPicker').value;
  if (!confirm(`Run automated payroll generation for ${m}?`)) return;

  try {
    const res = await api('/payroll/generate', {
      method: 'POST',
      body: JSON.stringify({ month_year: m })
    });
    alert(res.message || 'Payroll generated successfully!');
    loadPayrollRecords();
  } catch (err) {
    alert(err.message);
  }
}

function downloadPayslip(id) {
  window.open(`/api/payroll/slips/${id}/pdf?token=${token}`, '_blank');
}

// ================= GEOFENCE & WI-FI =================
async function loadGeofenceAndWifi() {
  try {
    const [offRes, netRes] = await Promise.all([
      api('/office/locations'),
      api('/settings/network').catch(() => ({ settings: {} }))
    ]);

    if (offRes.offices && offRes.offices.length > 0) {
      const off = offRes.offices[0];
      document.getElementById('geoOfficeName').value = off.name || '';
      document.getElementById('geoLat').value = off.latitude || '';
      document.getElementById('geoLng').value = off.longitude || '';
      document.getElementById('geoRadius').value = off.radius_meters || 150;
      document.getElementById('geoAddress').value = off.address || '';
    }

    if (netRes.settings) {
      document.getElementById('wifiToggle').checked = Boolean(netRes.settings.wifi_validation_enabled);
      document.getElementById('wifiSsidInput').value = netRes.settings.allowed_wifi_ssids || '';
    }
  } catch (err) {
    alert(err.message);
  }
}

async function handleSaveGeofence() {
  const name = document.getElementById('geoOfficeName').value.trim();
  const lat = parseFloat(document.getElementById('geoLat').value);
  const lng = parseFloat(document.getElementById('geoLng').value);
  const radius = parseFloat(document.getElementById('geoRadius').value);
  const address = document.getElementById('geoAddress').value.trim();

  try {
    await api('/office/locations/default-office', {
      method: 'PUT',
      body: JSON.stringify({ name, latitude: lat, longitude: lng, radius_meters: radius, address })
    });
    alert('Office geofence parameters saved successfully!');
    loadGeofenceAndWifi();
  } catch (err) {
    alert(err.message);
  }
}

function handleSyncGps() {
  if (!navigator.geolocation) {
    alert('Geolocation is not supported by your browser.');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    pos => {
      document.getElementById('geoLat').value = pos.coords.latitude.toFixed(6);
      document.getElementById('geoLng').value = pos.coords.longitude.toFixed(6);
      alert(`Updated coordinates from your real device GPS:\nLat: ${pos.coords.latitude.toFixed(6)}, Lng: ${pos.coords.longitude.toFixed(6)}\n\nClick "Save Geofence" to apply.`);
    },
    err => alert(`Could not read GPS location: ${err.message}`)
  );
}

async function handleSaveWifiSettings() {
  const enabled = document.getElementById('wifiToggle').checked;
  const ssids = document.getElementById('wifiSsidInput').value.trim();

  try {
    await api('/settings/network', {
      method: 'PUT',
      body: JSON.stringify({
        wifi_validation_enabled: enabled,
        allowed_wifi_ssids: ssids
      })
    });
    alert(`Wi-Fi validation policy updated!\nStatus: ${enabled ? 'ENABLED (Enforced)' : 'DISABLED (Optional)'}`);
    loadGeofenceAndWifi();
    loadDashboardData();
  } catch (err) {
    alert(err.message);
  }
}

// ================= SECURITY LOGS =================
async function loadSecurityLogs() {
  try {
    const res = await api('/security/login-logs');
    const list = res.logs || [];
    const tbody = document.getElementById('securityLogsTbody');

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 25px; color: var(--text-muted);">No security logs recorded.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.slice(0, 50).map(l => `
      <tr>
        <td>${new Date(l.timestamp).toLocaleString('en-IN')}</td>
        <td><strong>${l.employee_code || '--'}</strong></td>
        <td>${l.user_type || 'STAFF'}</td>
        <td><span class="status-pill ${l.login_status === 'SUCCESS' ? 'pill-success' : 'pill-danger'}">${l.login_status}</span></td>
        <td><code>${l.device_id ? l.device_id.slice(0, 16) + '...' : 'Browser/Direct'}</code></td>
        <td style="color: ${l.login_status === 'SUCCESS' ? 'var(--text-muted)' : 'var(--danger)'};">${l.failure_reason || l.verification_status || 'OK'}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.warn('Error loading logs', err);
  }
}

// ================= MODAL HELPERS =================
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}
