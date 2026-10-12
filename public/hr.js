// HR Web Portal Logic - Attendance System & Management Panel
let token = localStorage.getItem('us_token');
let user = null;
let departmentsList = [];
let teamLeadersList = [];
let employeesList = [];

// Punch & Timer state
let todayRecord = null;
let workingTimerInterval = null;
let currentCoords = { latitude: 12.9716, longitude: 77.5946 };
let officeLocation = null;
let capturedSelfieBase64 = null;
let webcamStream = null;

// Filter states
let myHistorySelectedMonth = new Date().toISOString().slice(0, 7);
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
  if (!token) {
    window.location.href = 'index.html';
    return;
  }

  try {
    user = JSON.parse(localStorage.getItem('us_user'));
    if (!user || (user.role !== 'HR' && user.role !== 'ADMIN' && user.role !== 'HR_ADMIN')) {
      alert('Access Denied: Only HR personnel and administrators have access to this portal.');
      handleLogout();
      return;
    }
  } catch (e) {
    handleLogout();
    return;
  }

  document.getElementById('hrUserName').innerText = user.full_name || 'HR Officer';
  document.getElementById('hrUserEmail').innerText = user.email || 'hr@unitedsoft.com';

  document.getElementById('hrHistoryMonthPicker').value = myHistorySelectedMonth;
  document.getElementById('attMonthInput').value = attSelectedMonth;
  document.getElementById('payrollMonthPicker').value = attSelectedMonth;
  document.getElementById('outsideDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('applyStartDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('applyEndDate').value = new Date().toISOString().split('T')[0];

  startLiveClock();
  initGpsLocation();

  await loadMetadata();
  await loadOfficeLocation();
  await loadTodayPunchStatus();
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

  if (secId === 'my-attendance') loadTodayPunchStatus();
  else if (secId === 'my-history') loadMyHistory();
  else if (secId === 'staff') loadStaffDirectory();
  else if (secId === 'attendance-oversight') { loadAttendance(); loadOutsideShiftEntries(); }
  else if (secId === 'leaves') loadLeaves();
  else if (secId === 'payroll') loadPayrollRecords();
}

// ================= METADATA & LOCATION =================
async function loadMetadata() {
  try {
    const [deptRes, tlRes, colRes] = await Promise.all([
      api('/departments'),
      api('/team-leaders'),
      api('/outside-shift/colleges').catch(() => ({ colleges: [] }))
    ]);

    departmentsList = deptRes.departments || [];
    teamLeadersList = tlRes.teamLeaders || tlRes.team_leaders || [];

    renderDeptChips('staffDeptChipsRow', departmentsList, setStaffDeptFilter);
    renderDeptChips('attDeptChipsRow', departmentsList, setAttDeptFilter);
    renderDeptChips('leaveDeptChipsRow', departmentsList, setLeaveDeptFilter);

    const colSelect = document.getElementById('outsideCollegeSelect');
    if (colSelect) {
      colSelect.innerHTML = (colRes.colleges || []).map(c => `<option value="${c}">${c}</option>`).join('');
      colSelect.innerHTML += `<option value="CUSTOM">-- Enter Other College / Venue --</option>`;
    }

    const tlSelect = document.getElementById('addStaffTL');
    if (tlSelect) {
      tlSelect.innerHTML = '<option value="">None / Direct</option>' +
        teamLeadersList.map(t => `<option value="${t.id}">${t.full_name} (${t.department})</option>`).join('');
    }
  } catch (err) {
    console.warn('Metadata loading warning', err);
  }
}

async function loadOfficeLocation() {
  try {
    const res = await api('/office/locations');
    if (res.offices && res.offices.length > 0) {
      officeLocation = res.offices[0];
      updateGpsDistance();
    }
  } catch (err) {
    console.warn('Could not load office location', err);
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

// ================= HR SELF-ATTENDANCE SYSTEM =================
function startLiveClock() {
  function tick() {
    const now = new Date();
    document.getElementById('liveClock').innerText = now.toLocaleTimeString('en-IN', { hour12: false });
    document.getElementById('liveDate').innerText = now.toLocaleDateString('en-IN', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }
  tick();
  setInterval(tick, 1000);
}

function initGpsLocation() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      pos => {
        currentCoords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        updateGpsDistance();
      },
      err => {
        document.getElementById('metaGpsDistance').innerText = 'GPS: Location unavailable';
      },
      { enableHighAccuracy: true }
    );
  } else {
    document.getElementById('metaGpsDistance').innerText = 'GPS: Not supported';
  }
}

function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * rad) * Math.cos(lat2 * rad) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

function updateGpsDistance() {
  if (!officeLocation || !currentCoords) return;
  const dist = calculateDistanceMeters(
    currentCoords.latitude,
    currentCoords.longitude,
    officeLocation.latitude,
    officeLocation.longitude
  );
  const maxRadius = officeLocation.radius_meters || 150;
  const inRange = dist <= maxRadius;
  const distEl = document.getElementById('metaGpsDistance');
  distEl.innerText = `${dist}m from office (${inRange ? 'Within Range' : 'Outside Boundary'})`;
  distEl.style.color = inRange ? '#6EE7B7' : '#FCA5A5';
}

async function loadTodayPunchStatus() {
  try {
    const res = await api('/attendance/today');
    todayRecord = res.todayRecord || null;

    const statusBadge = document.getElementById('punchStatusBadge');
    const statusText = document.getElementById('punchStatusText');
    const btnCheckIn = document.getElementById('btnCheckIn');
    const btnCheckOut = document.getElementById('btnCheckOut');
    const summaryBox = document.getElementById('todaySummaryBox');

    if (!todayRecord || !todayRecord.check_in_time) {
      statusText.innerText = 'Not Checked In';
      statusBadge.style.background = 'rgba(239, 68, 68, 0.2)';
      btnCheckIn.style.display = 'inline-flex';
      btnCheckOut.style.display = 'none';
      document.getElementById('metaFirstIn').innerText = '--:--';
      document.getElementById('metaLastOut').innerText = '--:--';
      document.getElementById('metaElapsedTime').innerText = '00h 00m 00s';
      stopElapsedTimer();

      summaryBox.innerHTML = `
        <div style="padding: 10px; background: #F8FAFC; border-radius: var(--radius-md); border: 1px solid var(--border);">
          <i class="fa-solid fa-circle-info" style="color: var(--secondary);"></i> You have not punched in yet today. Click "Check In / Punch In" above to start your shift.
        </div>
      `;
    } else {
      const inTime = new Date(todayRecord.check_in_time);
      document.getElementById('metaFirstIn').innerText = inTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      if (todayRecord.check_out_time) {
        // Checked Out
        const outTime = new Date(todayRecord.check_out_time);
        document.getElementById('metaLastOut').innerText = outTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        statusText.innerText = 'Shift Completed (Checked Out)';
        statusBadge.style.background = 'rgba(16, 185, 129, 0.2)';
        btnCheckIn.style.display = 'none';
        btnCheckOut.style.display = 'none';
        stopElapsedTimer();
        const totalSecs = Math.floor((outTime - inTime) / 1000);
        document.getElementById('metaElapsedTime').innerText = formatSeconds(totalSecs);

        summaryBox.innerHTML = `
          <div style="display: flex; gap: 20px; flex-wrap: wrap;">
            <div><strong>Shift Date:</strong> ${todayRecord.date}</div>
            <div><strong>Total Working Hours:</strong> ${todayRecord.working_hours} hrs</div>
            <div><strong>Status:</strong> <span class="status-pill pill-success">${todayRecord.status}</span></div>
          </div>
        `;
      } else {
        // Checked In, actively working
        statusText.innerText = 'Currently Checked In';
        statusBadge.style.background = 'rgba(16, 185, 129, 0.2)';
        btnCheckIn.style.display = 'none';
        btnCheckOut.style.display = 'inline-flex';
        document.getElementById('metaLastOut').innerText = '--:--';
        startElapsedTimer(inTime);

        summaryBox.innerHTML = `
          <div style="display: flex; gap: 20px; flex-wrap: wrap;">
            <div><strong>Checked In At:</strong> ${inTime.toLocaleTimeString()}</div>
            <div><strong>Current Status:</strong> <span class="status-pill pill-success">${todayRecord.status}</span></div>
            <div><strong>Proximity:</strong> ${Math.round(todayRecord.distance_meters || 0)}m from office center</div>
          </div>
        `;
      }
    }
  } catch (err) {
    console.warn('Error loading today punch', err);
  }
}

function startElapsedTimer(startTime) {
  stopElapsedTimer();
  function update() {
    const elapsedSecs = Math.max(0, Math.floor((Date.now() - startTime.getTime()) / 1000));
    document.getElementById('metaElapsedTime').innerText = formatSeconds(elapsedSecs);
  }
  update();
  workingTimerInterval = setInterval(update, 1000);
}

function stopElapsedTimer() {
  if (workingTimerInterval) {
    clearInterval(workingTimerInterval);
    workingTimerInterval = null;
  }
}

function formatSeconds(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

// Camera / Webcam helpers
async function toggleWebcam() {
  const container = document.getElementById('webcamContainer');
  if (container.style.display === 'block') {
    closeWebcam();
    return;
  }

  try {
    webcamStream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
    const video = document.getElementById('webcamVideo');
    video.srcObject = webcamStream;
    container.style.display = 'block';
    document.getElementById('cameraBtnText').innerText = 'Close Camera';
  } catch (err) {
    alert(`Could not access camera: ${err.message}. You can punch in directly.`);
  }
}

function captureSelfieSnapshot() {
  const video = document.getElementById('webcamVideo');
  const canvas = document.getElementById('webcamCanvas');
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  capturedSelfieBase64 = canvas.toDataURL('image/jpeg', 0.8);

  document.getElementById('selfieImg').src = capturedSelfieBase64;
  document.getElementById('selfiePreviewWrap').style.display = 'block';
  closeWebcam();
}

function closeWebcam() {
  if (webcamStream) {
    webcamStream.getTracks().forEach(track => track.stop());
    webcamStream = null;
  }
  document.getElementById('webcamContainer').style.display = 'none';
  document.getElementById('cameraBtnText').innerText = capturedSelfieBase64 ? 'Change Selfie' : 'Attach Selfie';
}

async function handleCheckIn() {
  const btn = document.getElementById('btnCheckIn');
  btn.disabled = true;
  btn.style.opacity = '0.7';

  try {
    const res = await api('/attendance/check-in', {
      method: 'POST',
      body: JSON.stringify({
        latitude: currentCoords.latitude,
        longitude: currentCoords.longitude,
        photo: capturedSelfieBase64 || undefined,
        verificationMethod: capturedSelfieBase64 ? 'PHOTO_GPS' : 'DIGITAL_GPS'
      })
    });

    alert(res.message || 'Check-In recorded successfully!');
    await loadTodayPunchStatus();
  } catch (err) {
    // Exact requirement Wi-Fi check failure handling
    if (err.message && err.message.includes('authorized company network')) {
      alert('Check-In is allowed only from the authorized company network.');
    } else {
      alert(`Check-In Failed: ${err.message}`);
    }
  } finally {
    btn.disabled = false;
    btn.style.opacity = '1';
  }
}

async function handleCheckOut() {
  if (!confirm('Are you sure you want to Check Out and complete your shift today?')) return;
  const btn = document.getElementById('btnCheckOut');
  btn.disabled = true;

  try {
    const res = await api('/attendance/check-out', {
      method: 'POST',
      body: JSON.stringify({
        latitude: currentCoords.latitude,
        longitude: currentCoords.longitude
      })
    });
    alert(`Check-Out recorded successfully!\nTotal Working Hours: ${res.record?.working_hours || 0} hrs`);
    await loadTodayPunchStatus();
  } catch (err) {
    alert(`Check-Out Failed: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
}

// ================= HR MY PUNCH HISTORY =================
async function loadMyHistory() {
  myHistorySelectedMonth = document.getElementById('hrHistoryMonthPicker').value;
  try {
    const res = await api(`/attendance/my-history?month=${myHistorySelectedMonth}`);
    const records = res.records || [];
    const summary = res.summary || {};

    document.getElementById('myPresentDays').innerText = summary.present_days || records.filter(r => r.status === 'PRESENT').length;
    document.getElementById('myLateDays').innerText = summary.late_days || records.filter(r => r.status === 'LATE').length;
    document.getElementById('myTotalHours').innerText = `${Math.round(summary.total_working_hours || 0)} hrs`;

    const tbody = document.getElementById('myHistoryTbody');
    if (records.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 25px; color: var(--text-muted);">No punch records found for ${myHistorySelectedMonth}.</td></tr>`;
      return;
    }

    tbody.innerHTML = records.map(r => `
      <tr>
        <td><strong>${r.date}</strong></td>
        <td>${r.check_in_time ? new Date(r.check_in_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}</td>
        <td>${r.check_out_time ? new Date(r.check_out_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}</td>
        <td><strong>${r.working_hours || 0} hrs</strong></td>
        <td><span class="status-pill ${r.status === 'PRESENT' ? 'pill-success' : 'pill-warning'}">${r.status}</span></td>
        <td>${r.verification_method || 'DIGITAL_GPS'}</td>
      </tr>
    `).join('');
  } catch (err) {
    alert(err.message);
  }
}

// ================= HR MANAGEMENT: STAFF DIRECTORY =================
async function loadStaffDirectory() {
  try {
    const q = new URLSearchParams();
    if (staffSearchQuery) q.append('search', staffSearchQuery);
    if (staffDeptFilter) q.append('department', staffDeptFilter);

    const res = await api(`/employees?${q.toString()}`);
    employeesList = res.employees || [];
    renderStaffTable();

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
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 25px; color: var(--text-muted);">No employees found.</td></tr>`;
    return;
  }

  tbody.innerHTML = employeesList.map(emp => {
    const isBound = Boolean(emp.device_registered);
    const rolePill = emp.role === 'ADMIN' || emp.role === 'HR_ADMIN' ? 'pill-info' : emp.role === 'TL' ? 'pill-warning' : 'pill-success';

    return `
      <tr>
        <td>
          <div style="font-weight: 700;">${emp.full_name}</div>
          <div style="font-size: 11.5px; color: var(--text-muted);">${emp.employee_code} • ${emp.email}</div>
        </td>
        <td><span class="status-pill ${rolePill}">${emp.role === 'TL' ? 'Team Lead (TL)' : emp.role}</span></td>
        <td>
          <div style="font-weight: 600;">${emp.designation || '--'}</div>
          <div style="font-size: 11px; color: var(--text-muted);">${emp.department || '--'}</div>
        </td>
        <td>₹${(emp.base_salary || 0).toLocaleString('en-IN')}</td>
        <td>
          ${isBound
            ? `<span class="status-pill pill-success"><i class="fa-solid fa-lock"></i> Device Bound</span>`
            : `<span class="status-pill pill-warning"><i class="fa-solid fa-unlock"></i> Unbound</span>`
          }
        </td>
        <td>
          <div style="display: flex; gap: 6px;">
            ${isBound ? `
              <button class="btn btn-outline btn-sm" onclick="handleResetDevice('${emp.id}', '${emp.full_name}')" title="Reset device">
                <i class="fa-solid fa-rotate-left" style="color: var(--danger);"></i> Reset
              </button>
            ` : ''}
            <button class="btn btn-outline btn-sm" onclick="handleGeneratePin('${emp.id}', '${emp.full_name}')" title="Generate emergency PIN">
              <i class="fa-solid fa-key" style="color: var(--primary);"></i> PIN
            </button>
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
    alert('Staff member created successfully!');
    closeModal('modalAddStaff');
    await loadStaffDirectory();
    await loadMetadata();
  } catch (err) {
    alert(err.message);
  }
}

async function handleResetDevice(empId, name) {
  if (!confirm(`Reset device binding for ${name}?`)) return;
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
    alert(`Emergency PIN for ${name}: ${res.verificationCode || res.code}`);
  } catch (err) {
    alert(err.message);
  }
}

// ================= HR MANAGEMENT: ATTENDANCE OVERSIGHT =================
async function loadAttendance() {
  try {
    const q = new URLSearchParams();
    if (attDeptFilter) q.append('department', attDeptFilter);
    if (attSelectedMonth) q.append('month', attSelectedMonth);

    const res = await api(`/attendance/all?${q.toString()}`);
    const list = res.attendance || [];
    const tbody = document.getElementById('attendanceTbody');

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 25px; color: var(--text-muted);">No records found for ${attSelectedMonth}.</td></tr>`;
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
        <td>${item.verification_method || 'GPS'}</td>
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
    const list = res.entries || [];
    const tbody = document.getElementById('outsideShiftTbody');

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
        <td>${item.work_description || item.purpose || 'Campus Assignment'}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.warn('Error loading outside shift', err);
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
        staff_name: emp ? emp.full_name : user.full_name,
        department: emp ? emp.department : user.department,
        college_name: collegeName,
        date: date,
        start_time: timing.split('-')[0]?.trim() || '09:30 AM',
        end_time: timing.split('-')[1]?.trim() || '05:30 PM',
        work_description: purpose,
        purpose: purpose
      })
    });
    alert('Outside-shift entry recorded successfully!');
    closeModal('modalOutsideShift');
    loadOutsideShiftEntries();
    loadAttendance();
  } catch (err) {
    alert(err.message);
  }
}

// ================= PERSONAL LEAVE APPLICATION =================
function openApplyLeaveModal() {
  document.getElementById('modalApplyLeave').classList.add('open');
}

async function handleApplyLeave(e) {
  e.preventDefault();
  const leaveType = document.getElementById('applyLeaveType').value;
  const startDate = document.getElementById('applyStartDate').value;
  const endDate = document.getElementById('applyEndDate').value;
  const reason = document.getElementById('applyReason').value.trim();

  try {
    await api('/leaves/apply', {
      method: 'POST',
      body: JSON.stringify({
        leave_type: leaveType,
        start_date: startDate,
        end_date: endDate,
        reason: reason
      })
    });
    alert('Leave request submitted successfully!');
    closeModal('modalApplyLeave');
  } catch (err) {
    alert(err.message);
  }
}

// ================= HR MANAGEMENT: LEAVE APPROVALS =================
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
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div class="card" style="text-align: center; padding: 40px; color: var(--text-muted);">No leave requests matching filter.</div>`;
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
            <strong>HR Remarks (${lv.hr_name || lv.approver_name || 'HR Admin'}):</strong> ${lv.hr_remarks || lv.comments}
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
  document.getElementById('leaveDecisionRemarks').value = action === 'APPROVED' ? 'Approved by HR Executive' : 'Declined due to coverage requirement';

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

// ================= HR MANAGEMENT: PAYROLL OVERSIGHT =================
async function loadPayrollRecords() {
  const m = document.getElementById('payrollMonthPicker').value;
  try {
    const res = await api(`/payroll/records?month_year=${m}`);
    const list = res.records || [];
    const tbody = document.getElementById('payrollTbody');

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 25px; color: var(--text-muted);">No payroll generated for ${m}. Click "Run Payroll" to compute.</td></tr>`;
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
          <button class="btn btn-outline btn-sm" onclick="downloadPayslip('${item.id}')" title="Download PDF Payslip">
            <i class="fa-solid fa-file-pdf" style="color: var(--danger);"></i> PDF
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

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}
