import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Upload, Download, Users, BookOpen, Edit, Search, X, Plus } from 'lucide-react';
import { useAppContext } from './AuthWrapper';
import './ManageClass.css';

const API_BASE = 'http://localhost:3000';

const ManageClass = () => {
  const { students, setStudents, subjects, setSubjects, batches, setBatches, user } = useAppContext();
  const [currentStep, setCurrentStep] = useState('main');
  const [showSnackbar, setShowSnackbar] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');
  const [uploadedFile, setUploadedFile] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [editingStudent, setEditingStudent] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Form states
  const [batchForm, setBatchForm] = useState({ from: '', to: '', name: '' });
  const [theoryForm, setTheoryForm] = useState({ code: '', name: '', faculty: '' });
  const [practicalForm, setPracticalForm] = useState({
    code: '',
    name: '',
    faculties: {}
  });
  const [availableFaculties, setAvailableFaculties] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  // Show message function - stable reference
  const showMessage = useCallback((message, type = 'success') => {
    setSnackbarMessage(message);
    setShowSnackbar(true);
    setTimeout(() => setShowSnackbar(false), 3000);
  }, []);

  // API helpers - stable references
  const authHeaders = useCallback(() => {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const postJSON = useCallback(async (url, body) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.message || 'Request failed');
    return data;
  }, [authHeaders]);

  const postForm = useCallback(async (url, formData) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...authHeaders() },
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.message || 'Request failed');
    return data;
  }, [authHeaders]);

  // Fetch available faculties
  const fetchAvailableFaculties = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_BASE}/api/class-teacher/faculties`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      
      if (data.success) {
        setAvailableFaculties(data.faculties || []);
      }
    } catch (error) {
      console.error('Error fetching faculties:', error);
    }
  }, []);

  // Fetch subjects from backend
  const fetchSubjects = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_BASE}/api/class-teacher/subjects`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      
      if (data.success) {
        setSubjects({
          theory: data.subjects.theory || [],
          practical: data.subjects.practical || []
        });
      }
    } catch (error) {
      console.error('Error fetching subjects:', error);
    }
  }, [setSubjects]);

  // Fetch initial data
  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const token = localStorage.getItem('token');

        // Fetch students and batches concurrently
        const [studentsRes, batchesRes] = await Promise.all([
          fetch(`${API_BASE}/api/class-teacher/students`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`${API_BASE}/api/class-teacher/batches`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);

        const [studentsData, batchesData] = await Promise.all([
          studentsRes.json(),
          batchesRes.json(),
        ]);

        if (studentsRes.ok && batchesRes.ok) {
          // Normalize students
          const normalizedStudents = (studentsData.students || []).map((s) => ({
            id: s.id,
            name: s.name,
            rollNumber: s.roll_no,
            hallTicket: s.hall_ticket_number,
            email: s.email,
            contact: s.mobile,
            attendance_percent: s.attendance_percent,
            defaulter: s.defaulter,
            batch_id: s.batch_id,
            batch_name: s.batch_name || '',
          }));

          setStudents(normalizedStudents);
          
          // Normalize batches
          const normalizedBatches = (batchesData.batches || []).map((b) => ({
            id: b.id,
            name: b.name,
            from: b.roll_start,
            to: b.roll_end,
          }));
          
          setBatches(normalizedBatches);
        } else {
          showMessage(
            studentsData.error ||
              batchesData.error ||
              'Failed to fetch data',
            'error'
          );
        }
      } catch (err) {
        showMessage(`Error fetching data: ${err.message}`, 'error');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
    fetchAvailableFaculties();
    fetchSubjects();
  }, [setStudents, setBatches, showMessage, fetchAvailableFaculties, fetchSubjects]);

  // File upload handlers
  const handleFileUpload = useCallback((event) => {
    const file = event.target.files[0];
    if (!file) return;

    const allowed =
      file.type === 'application/vnd.ms-excel' ||
      file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.type === 'text/csv';

    if (!allowed) {
      showMessage('Please upload .xlsx, .xls, or .csv', 'error');
      return;
    }

    setUploadedFile(file);
    setShowPreview(true);
    showMessage('File selected. Click "Import Students & Continue".');
  }, [showMessage]);

  const uploadAndImportStudents = useCallback(async () => {
    if (!uploadedFile) {
      showMessage('Select a file first.', 'error');
      return;
    }
    try {
      const formData = new FormData();
      formData.append('file', uploadedFile);

      const data = await postForm(`${API_BASE}/api/class-teacher/import-students`, formData);

      showMessage(data.message || 'Import completed.');
      setCurrentStep('batch-allocation');
      // Refresh students list
      const token = localStorage.getItem('token');
      const studentsRes = await fetch(`${API_BASE}/api/class-teacher/students`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const studentsData = await studentsRes.json();
      if (studentsRes.ok) {
        const normalizedStudents = (studentsData.students || []).map((s) => ({
          id: s.id,
          name: s.name,
          rollNumber: s.roll_no,
          hallTicket: s.hall_ticket_number,
          email: s.email,
          contact: s.mobile,
          attendance_percent: s.attendance_percent,
          defaulter: s.defaulter,
          batch_id: s.batch_id,
          batch_name: s.batch_name || '',
        }));
        setStudents(normalizedStudents);
      }
    } catch (err) {
      showMessage(`Import failed: ${err.message}`, 'error');
    }
  }, [uploadedFile, showMessage, postForm, setStudents]);

  const downloadFormat = useCallback(() => {
    const csvContent = "roll_no,name,hall_ticket_number,attendance_percent\n1,John Doe,230101080565,82";
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'student_import_template.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  }, []);

  // Batch operations
  const addBatch = useCallback(async () => {
    const from = parseInt(batchForm.from, 10);
    const to = parseInt(batchForm.to, 10);
    const name = (batchForm.name || '').trim();

    if (!from || !to || !name) {
      showMessage('Enter valid From, Till, and Batch Name.', 'error');
      return;
    }
    if (from > to) {
      showMessage('"From" cannot be greater than "Till".', 'error');
      return;
    }
    if (!user?.id) {
      showMessage('User not found in context. Re-login.', 'error');
      return;
    }

    try {
      const payload = {
        name,
        roll_start: from,
        roll_end: to,
        faculty_id: user.id,
      };

      const data = await postJSON(`${API_BASE}/api/class-teacher/create-batch`, payload);

      const created = data.batch;
      const normalized = {
        id: created.id,
        name: created.name,
        from: created.roll_start,
        to: created.roll_end,
      };

      setBatches(prev => [...prev, normalized]);
      setBatchForm({ from: '', to: '', name: '' });
      showMessage('Batch created & students assigned.');
    } catch (err) {
      showMessage(`Create batch failed: ${err.message}`, 'error');
    }
  }, [batchForm, user, showMessage, postJSON, setBatches]);

  const deleteBatch = useCallback((id) => {
    setBatches(prev => prev.filter(batch => batch.id !== id));
    showMessage('Batch deleted locally. (No backend endpoint yet.)');
  }, [setBatches, showMessage]);

  // Subject operations
  const addTheorySubject = useCallback(async () => {
    if (!theoryForm.code || !theoryForm.name || !theoryForm.faculty) {
      showMessage('Please fill all fields', 'error');
      return;
    }

    try {
      // Backend will get class_id from token and department_id from users table
      const payload = {
        subject_code: theoryForm.code,
        subject_name: theoryForm.name,
        type: 'theory',
        faculty_id: theoryForm.faculty
      };

      const data = await postJSON(`${API_BASE}/api/class-teacher/subjects/assign`, payload);
      
      // Refresh subjects from backend
      await fetchSubjects();
      
      setTheoryForm({ code: '', name: '', faculty: '' });
      showMessage(data.message || 'Theory subject added successfully!');
    } catch (err) {
      showMessage(`Failed to add theory subject: ${err.message}`, 'error');
    }
  }, [theoryForm, showMessage, postJSON, fetchSubjects]);

  const addPracticalSubject = useCallback(async () => {
    if (!practicalForm.code || !practicalForm.name) {
      showMessage('Please fill subject code and name', 'error');
      return;
    }

    try {
      // Build faculty_assignments array from form data
      const facultyAssignments = Object.entries(practicalForm.faculties)
        .filter(([_, facultyId]) => facultyId)
        .map(([batchName, facultyId]) => {
          const batch = batches.find(b => b.name === batchName);
          return {
            batch_id: batch?.id,
            faculty_id: facultyId
          };
        })
        .filter(fa => fa.batch_id && fa.faculty_id);

      if (facultyAssignments.length === 0) {
        showMessage('Please assign at least one faculty to a batch', 'error');
        return;
      }

      // Backend will get class_id from token and department_id from users table
      const payload = {
        subject_code: practicalForm.code,
        subject_name: practicalForm.name,
        type: 'practical',
        faculty_assignments: facultyAssignments
      };

      const data = await postJSON(`${API_BASE}/api/class-teacher/subjects/assign`, payload);

      // Refresh subjects from backend
      await fetchSubjects();
      
      setPracticalForm({
        code: '',
        name: '',
        faculties: {}
      });
      showMessage(data.message || 'Practical subject added successfully!');
    } catch (err) {
      showMessage(`Failed to add practical subject: ${err.message}`, 'error');
    }
  }, [practicalForm, batches, showMessage, postJSON, fetchSubjects]);

  const deleteSubject = useCallback(async (id, type) => {
    if (!window.confirm('Are you sure you want to delete this subject?')) return;
    
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE}/api/class-teacher/subjects/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message);

      // Refresh subjects from backend
      await fetchSubjects();
      showMessage('Subject deleted successfully!');
    } catch (err) {
      showMessage(`Delete failed: ${err.message}`, 'error');
    }
  }, [showMessage, fetchSubjects]);

  // Student operations
  const updateStudent = useCallback(async (updatedStudent) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE}/api/class-teacher/student/${updatedStudent.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: updatedStudent.name,
          roll_no: updatedStudent.rollNumber,
          email: updatedStudent.email,
          mobile: updatedStudent.contact,
          attendance_percent: updatedStudent.attendance_percent || 0,
          hall_ticket_number: updatedStudent.hallTicket,
          batch_id: batches.find((b) => b.name === updatedStudent.batch_name)?.id || null,
          defaulter: updatedStudent.defaulter || false,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message);

      setStudents((prev) =>
        prev.map((s) => {
          if (s.id === updatedStudent.id) {
            return {
              ...s,
              name: data.student.name,
              rollNumber: data.student.roll_no,
              email: data.student.email,
              contact: data.student.mobile,
              attendance_percent: data.student.attendance_percent,
              hallTicket: data.student.hall_ticket_number,
              batch_id: data.student.batch_id,
              defaulter: data.student.defaulter,
            };
          }
          return s;
        })
      );

      setEditingStudent(null);
      showMessage('Student updated successfully!');
    } catch (err) {
      showMessage(`Update failed: ${err.message}`, 'error');
    }
  }, [batches, setStudents, showMessage]);

  const deleteStudent = useCallback(async (id) => {
    if (!window.confirm('Are you sure you want to delete this student?')) return;
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE}/api/class-teacher/student/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message);

      setStudents(prev => prev.filter(s => s.id !== id));
      showMessage('Student deleted successfully!');
    } catch (err) {
      showMessage(`Delete failed: ${err.message}`, 'error');
    }
  }, [setStudents, showMessage]);

  // Filter students for search
  const filteredStudents = useMemo(() => {
    return students.filter(student =>
      (student.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (student.rollNumber || '').toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [students, searchTerm]);

  // Memoized form handlers to prevent re-renders
  const handleTheoryFormChange = useCallback((field, value) => {
    setTheoryForm(prev => ({ ...prev, [field]: value }));
  }, []);

  const handlePracticalFormChange = useCallback((field, value) => {
    setPracticalForm(prev => ({ ...prev, [field]: value }));
  }, []);

  const handlePracticalFacultyChange = useCallback((batchName, facultyId) => {
    setPracticalForm(prev => ({
      ...prev,
      faculties: { ...prev.faculties, [batchName]: facultyId }
    }));
  }, []);

  // Stable click handlers for action cards
  const handleStepChange = useCallback((step) => {
    setCurrentStep(step);
  }, []);

  // UI Components - Memoized to prevent unnecessary re-renders
  const ActionCards = useMemo(() => (
    <div className="action-cards">
      <div className={`action-card ${currentStep === 'import' ? 'active' : ''}`} onClick={() => handleStepChange('import')}>
        <div className="card-header">
          <span>Import Students Data</span>
          <Upload size={20} />
        </div>
      </div>

      <div className={`action-card ${currentStep === 'subjects' ? 'active' : ''}`} onClick={() => handleStepChange('subjects')}>
        <div className="card-header">
          <span>Faculty Subject Allotment</span>
          <BookOpen size={20} />
        </div>
      </div>

      <div className={`action-card ${currentStep === 'edit-profile' ? 'active' : ''}`} onClick={() => handleStepChange('edit-profile')}>
        <div className="card-header">
          <span>Edit Student Profile</span>
          <Edit size={20} />
        </div>
      </div>
    </div>
  ), [currentStep, handleStepChange]);

  const MainView = useMemo(() => (
    <div className="manage-class-main">
      <h2>Manage Class</h2>
      {ActionCards}
    </div>
  ), [ActionCards]);

  const ImportStudentsView = useMemo(() => (
    <div className="import-students">
      <h2>Manage Class</h2>
      {ActionCards}

      <div className="bulk-upload-section">
        <div className="section-header">
          <Users size={20} />
          <span>Bulk Upload Student Data</span>
          <button className="download-format-btn" onClick={downloadFormat}>
            <Download size={16} />
            Download Template
          </button>
        </div>

        <div className="upload-area">
          <div className="upload-icon">
            <Upload size={40} />
          </div>
          <h3>Upload Excel/CSV Here</h3>
          <ul className="upload-instructions">
            <li>Allowed: .xlsx, .xls, .csv</li>
            <li>Required columns: <b>roll_no, name, hall_ticket_number, attendance_percent</b></li>
            <li>Data will be stored for your class automatically.</li>
          </ul>

          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileUpload}
            style={{ display: 'none' }}
            id="excel-upload"
          />
          <label htmlFor="excel-upload" className="upload-btn">
            Choose File
          </label>

          {uploadedFile && (
            <p className="file-info">Selected: {uploadedFile.name}</p>
          )}
        </div>

        {showPreview && (
          <div className="preview-section">
            <h4>Ready to Import</h4>
            <p>We'll parse the file on the server and insert students for your class.</p>
            <button className="next-btn" onClick={uploadAndImportStudents}>
              Import Students & Continue
            </button>
          </div>
        )}
      </div>
    </div>
  ), [ActionCards, uploadedFile, showPreview, handleFileUpload, downloadFormat, uploadAndImportStudents]);

  const BatchAllocationView = useMemo(() => (
    <div className="batch-allocation">
      <h2>Manage Class</h2>
      {ActionCards}

      <div className="batch-section">
        <div className="section-header">
          <Users size={20} />
          <span>Batch Wise Allocation</span>
        </div>

        <div className="batch-form">
          <div className="batch-inputs">
            <div className="input-group">
              <label>From :</label>
              <input
                type="number"
                value={batchForm.from}
                onChange={(e) => setBatchForm(prev => ({ ...prev, from: e.target.value }))}
                placeholder="01"
              />
            </div>
            <div className="input-group">
              <label>Till :</label>
              <input
                type="number"
                value={batchForm.to}
                onChange={(e) => setBatchForm(prev => ({ ...prev, to: e.target.value }))}
                placeholder="20"
              />
            </div>
            <div className="input-group">
              <label>Batch Name :</label>
              <input
                type="text"
                value={batchForm.name}
                onChange={(e) => setBatchForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="C1"
              />
            </div>
          </div>

          <button className="add-batch-btn" onClick={addBatch}>
            <Plus size={16} />
            Add Batch
          </button>
        </div>

        <div className="existing-batches">
          <h4>Existing Batches</h4>
          {batches.map(batch => (
            <div key={batch.id} className="batch-item">
              <span>From {batch.from} to {batch.to} - {batch.name}</span>
              <button
                className="delete-btn"
                onClick={() => deleteBatch(batch.id)}
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>

        <button className="next-btn" onClick={() => setCurrentStep('success')}>
          Complete Setup
        </button>
      </div>
    </div>
  ), [ActionCards, batchForm, batches, addBatch, deleteBatch]);

  const SuccessView = useMemo(() => (
    <div className="success-view">
      <h2>Manage Class</h2>
      {ActionCards}

      <div className="success-section">
        <div className="section-header">
          <Users size={20} />
          <span>All Set !</span>
        </div>

        <div className="success-content">
          <div className="success-icon">
            <div className="celebration-icon">🎉</div>
          </div>
          <h2>Success!</h2>
          <div className="success-message">
            <p>Now, Students can access their profile by</p>
            <p><strong>Username : Hall Ticket Number</strong></p>
            <p><strong>Password : Hall Ticket Number</strong></p>
          </div>
          <button className="finish-btn" onClick={() => setCurrentStep('main')}>
            Finish...
          </button>
        </div>
      </div>
    </div>
  ), [ActionCards]);

  // Render SubjectsView directly without memoization to ensure inputs maintain focus
  const renderSubjectsView = () => (
    <div className="subjects-view">
      <h2>Manage Class</h2>
      {ActionCards}

      <div className="subjects-section">
        <div className="subjects-grid">
          {/* Theory Subject Form */}
          <div className="subject-form">
            <div className="form-header">
              <BookOpen size={20} />
              <span>Add Theory Subject</span>
            </div>

            <div className="form-fields">
              <input
                type="text"
                placeholder="Subject Code"
                value={theoryForm.code}
                onChange={(e) => handleTheoryFormChange('code', e.target.value)}
                autoComplete="off"
              />
              <input
                type="text"
                placeholder="Subject Name"
                value={theoryForm.name}
                onChange={(e) => handleTheoryFormChange('name', e.target.value)}
                autoComplete="off"
              />
              <select
                value={theoryForm.faculty}
                onChange={(e) => handleTheoryFormChange('faculty', e.target.value)}
              >
                <option value="">Select Faculty</option>
                {availableFaculties.map(faculty => (
                  <option key={faculty.id} value={faculty.id}>
                    {faculty.name}
                  </option>
                ))}
              </select>
              <button className="add-subject-btn" onClick={addTheorySubject}>
                Add Subject
              </button>
            </div>

            <div className="subjects-list">
              {(subjects.theory || []).map(subject => (
                <div key={subject.id} className="subject-card">
                  <div className="subject-info">
                    <span className="subject-code">{subject.code}</span>
                    <span className="subject-name">{subject.name}</span>
                    <span className="faculty-name">{subject.faculty}</span>
                  </div>
                  <button
                    className="delete-btn"
                    onClick={() => deleteSubject(subject.id, 'theory')}
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Practical Subject Form */}
          <div className="subject-form">
            <div className="form-header">
              <BookOpen size={20} />
              <span>Add Practical Subject</span>
            </div>

            <div className="form-fields">
              <input
                type="text"
                placeholder="Subject Code"
                value={practicalForm.code}
                onChange={(e) => handlePracticalFormChange('code', e.target.value)}
                autoComplete="off"
              />
              <input
                type="text"
                placeholder="Subject Name"
                value={practicalForm.name}
                onChange={(e) => handlePracticalFormChange('name', e.target.value)}
                autoComplete="off"
              />
              
              <div className="faculty-grid">
                {batches.length === 0 ? (
                  <p style={{ textAlign: 'center', color: '#666', padding: '20px', gridColumn: '1 / -1' }}>
                    No batches available. Please create batches first.
                  </p>
                ) : (
                  batches.map(batch => (
                    <div key={batch.id} className="faculty-input">
                      <label>{batch.name}</label>
                      <select
                        value={practicalForm.faculties[batch.name] || ''}
                        onChange={(e) => handlePracticalFacultyChange(batch.name, e.target.value)}
                      >
                        <option value="">Select Faculty</option>
                        {availableFaculties.map(faculty => (
                          <option key={faculty.id} value={faculty.id}>
                            {faculty.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))
                )}
              </div>
              
              <button className="add-subject-btn" onClick={addPracticalSubject}>
                Add Subject
              </button>
            </div>

            <div className="subjects-list">
              {(subjects.practical || []).map(subject => (
                <div key={subject.id} className="subject-card">
                  <div className="subject-info">
                    <span className="subject-code">{subject.code}</span>
                    <span className="subject-name">{subject.name}</span>
                    <div className="faculty-batches">
                      {Object.keys(subject.faculties || {}).length > 0 ? (
                        Object.entries(subject.faculties || {}).map(([batchName, facultyName]) => (
                          <span key={batchName} className="faculty-batch-item">
                            {batchName}: {facultyName}
                          </span>
                        ))
                      ) : (
                        <span className="faculty-name">No batches assigned</span>
                      )}
                    </div>
                  </div>
                  <button
                    className="delete-btn"
                    onClick={() => deleteSubject(subject.id, 'practical')}
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const EditProfileView = useMemo(() => (
    <div className="edit-profile-view">
      <h2>Manage Class</h2>
      {ActionCards}

      <div className="search-section">
        <div className="search-input-group">
          <Search size={20} />
          <input
            type="text"
            placeholder="Search student by name or roll number..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
        </div>
      </div>

      <div className="students-grid">
        {filteredStudents.map(student => (
          <div key={student.id} className="student-card">
            <div className="student-info">
              <h4>{student.name}</h4>
              <p>Roll: {student.rollNumber}</p>
              <p>Batch: {student.batch_name || 'Not assigned'}</p>
            </div>
            <div className="student-actions">
              <button
                className="edit-btn"
                onClick={() => setEditingStudent(student)}
              >
                <Edit size={16} />
                Edit
              </button>
              <button
                className="delete-btn"
                onClick={() => deleteStudent(student.id)}
              >
                <X size={16} />
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {editingStudent && (
        <StudentEditModal
          student={editingStudent}
          onSave={updateStudent}
          onClose={() => setEditingStudent(null)}
          batches={batches}
        />
      )}
    </div>
  ), [ActionCards, searchTerm, filteredStudents, editingStudent, batches, deleteStudent, updateStudent]);

  const renderCurrentView = () => {
    switch (currentStep) {
      case 'import':
        return ImportStudentsView;
      case 'batch-allocation':
        return BatchAllocationView;
      case 'success':
        return SuccessView;
      case 'subjects':
        return renderSubjectsView();
      case 'edit-profile':
        return EditProfileView;
      default:
        return MainView;
    }
  };

  return (
    <div className="manage-class">
      {isLoading && <div style={{ padding: '20px', textAlign: 'center' }}>Loading...</div>}
      {!isLoading && renderCurrentView()}

      {showSnackbar && (
        <div className={`snackbar ${snackbarMessage.toLowerCase().includes('fail') || snackbarMessage.toLowerCase().includes('error') ? 'error' : 'success'}`}>
          {snackbarMessage}
        </div>
      )}
    </div>
  );
};

// Student Edit Modal Component
const StudentEditModal = React.memo(({ student, onSave, onClose, batches }) => {
  const [formData, setFormData] = useState({ ...student });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
  };

  const handleChange = useCallback((field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  }, []);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Edit Student Profile</h3>
          <button className="close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="student-form">
          <div className="form-row">
            <div className="form-group">
              <label>Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => handleChange('name', e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label>Roll Number</label>
              <input
                type="text"
                value={formData.rollNumber}
                onChange={(e) => handleChange('rollNumber', e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Hall Ticket</label>
              <input
                type="text"
                value={formData.hallTicket}
                onChange={(e) => handleChange('hallTicket', e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => handleChange('email', e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Contact</label>
              <input
                type="text"
                value={formData.contact}
                onChange={(e) => handleChange('contact', e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label>Batch</label>
              <select
                value={formData.batch_name || ''}
                onChange={(e) => handleChange('batch_name', e.target.value)}
              >
                <option value="">Select Batch</option>
                {batches.map((batch) => (
                  <option key={batch.id} value={batch.name}>
                    {batch.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-actions">
            <button type="button" className="cancel-btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="save-btn">
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
});

export default ManageClass;