import express from "express";
import multer from "multer";
import xlsx from "xlsx";
import bcrypt from "bcryptjs";
import fs from "fs"
import { supabase } from '../db/supabaseClient.js'
import { authenticateUser, authorizeRoles  } from "../middlewares/auth.js";

const upload = multer({ dest: "uploads/" });
const calculateDefaulter = (attendance) => attendance < 75;
const router = express.Router();

// Get all faculties (all users except directors)
router.get('/faculties', authenticateUser, authorizeRoles("class_teacher"), async (req, res) => {
  try {
    const { data: faculties, error } = await supabase
      .from('users')
      .select('id, name, email, role')
      .neq('role', 'director')
      .order('name', { ascending: true });

    if (error) throw error;

    return res.json({ success: true, faculties });
  } catch (err) {
    console.error('Error fetching faculties:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/students', authenticateUser, authorizeRoles("class_teacher"), async (req, res) => {
  try {
    const classId = req.user.class_id;
    if (!classId) return res.status(400).json({ success: false, error: 'Missing class_id in token' });

    // ✅ Select with JOIN on batches (Supabase foreign table syntax)
    const { data, error } = await supabase
      .from('students')
      .select(`
        id,
        roll_no,
        name,
        email,
        mobile,
        attendance_percent,
        hall_ticket_number,
        defaulter,
        class_id,
        batch_id,
        created_at,
        batches ( name )
      `)
      .eq('class_id', classId)
      .order('roll_no', { ascending: true });

    if (error) throw error;

    // ✅ Normalize data to include batch_name directly
    const students = (data || []).map(s => ({
      ...s,
      batch_name: s.batches?.name || null,
    }));

    return res.json({ success: true, students });
  } catch (err) {
    console.error('Error fetching students:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/batches', authenticateUser, authorizeRoles("class_teacher"), async (req, res) => {
  try {
    const classId = req.user.class_id;
    if (!classId)
      return res.status(400).json({ success: false, error: 'Missing class_id in token' });

    const { data, error } = await supabase
      .from('batches')
      .select('id, name, roll_start, roll_end, faculty_id, class_id')
      .eq('class_id', classId)
      .order('name', { ascending: true });

    if (error) throw error;

    return res.json({ success: true, batches: data || [] });
  } catch (err) {
    console.error('Error fetching batches:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});


router.put("/student/:id", authenticateUser, authorizeRoles("class_teacher"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const classId = req.user.class_id;

      // Extract editable fields only
      const {
        name,
        roll_no,
        email,
        mobile,
        attendance_percent,
        hall_ticket_number,
        batch_id,
        defaulter, // optional override
      } = req.body;

      if (!id || !classId) {
        return res.status(400).json({ success: false, error: "Missing student ID or class ID" });
      }

      // Fetch the student to confirm same class
      const { data: student, error: fetchError } = await supabase
        .from("students")
        .select("id, class_id")
        .eq("id", id)
        .single();

      if (fetchError || !student) {
        return res.status(404).json({ success: false, error: "Student not found" });
      }

      if (student.class_id !== classId) {
        return res.status(403).json({ success: false, error: "Unauthorized to edit this student" });
      }

      const finalDefaulter =
        typeof defaulter === "boolean"
          ? defaulter
          : Number(attendance_percent) < 75;

      const { data: updated, error: updateError } = await supabase
        .from("students")
        .update({
          name,
          roll_no,
          email,
          mobile,
          attendance_percent,
          hall_ticket_number,
          batch_id,
          defaulter: finalDefaulter,
        })
        .eq("id", id)
        .select()
        .single();

      if (updateError) throw updateError;

      res.status(200).json({
        success: true,
        message: "Student updated successfully",
        student: updated,
      });
    } catch (err) {
      console.error("Update student error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

router.delete("/student/:id", authenticateUser, authorizeRoles("class_teacher"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const classId = req.user.class_id;

      if (!id || !classId) {
        return res.status(400).json({ success: false, error: "Missing student ID or class ID" });
      }

      // Confirm same class ownership
      const { data: student, error: fetchError } = await supabase
        .from("students")
        .select("id, class_id")
        .eq("id", id)
        .single();

      if (fetchError || !student) {
        return res.status(404).json({ success: false, error: "Student not found" });
      }

      if (student.class_id !== classId) {
        return res.status(403).json({ success: false, error: "Unauthorized to delete this student" });
      }

      const { error: deleteError } = await supabase
        .from("students")
        .delete()
        .eq("id", id);

      if (deleteError) throw deleteError;

      res.status(200).json({ success: true, message: "Student deleted successfully" });
    } catch (err) {
      console.error("Delete student error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

// Get subjects for the class teacher's class
router.get("/subjects", authenticateUser, authorizeRoles("class_teacher"), async (req, res) => {
  try {
    const classId = req.user.class_id;
    if (!classId) {
      return res.status(400).json({ success: false, error: "Missing class_id in token" });
    }

    // Fetch subjects
    const { data: subjects, error: subjectsError } = await supabase
      .from("subjects")
      .select(`
        id,
        subject_code,
        name,
        type,
        department_id,
        class_id,
        created_at
      `)
      .eq("class_id", classId)
      .order("created_at", { ascending: false });

    if (subjectsError) throw subjectsError;

    if (!subjects || subjects.length === 0) {
      return res.json({
        success: true,
        subjects: {
          theory: [],
          practical: [],
        },
      });
    }

    // Fetch faculty_subjects
    const { data: facultySubjects, error: facultySubjectsError } = await supabase
      .from("faculty_subjects")
      .select("id, faculty_id, subject_id, batch_id, class_id")
      .eq("class_id", classId);

    if (facultySubjectsError) throw facultySubjectsError;

    // Get all unique faculty IDs and batch IDs
    const facultyIds = [...new Set(facultySubjects.map((fs) => fs.faculty_id).filter(Boolean))];
    const batchIds = [...new Set(facultySubjects.map((fs) => fs.batch_id).filter(Boolean))];

    // Fetch faculty names
    const { data: faculties, error: facultiesError } = await supabase
      .from("users")
      .select("id, name")
      .in("id", facultyIds);

    if (facultiesError) throw facultiesError;

    // Fetch batch names
    const { data: batches, error: batchesError } = await supabase
      .from("batches")
      .select("id, name")
      .in("id", batchIds);

    if (batchesError) throw batchesError;

    // Create lookup maps
    const facultyMap = new Map(faculties?.map((f) => [f.id, f.name]) || []);
    const batchMap = new Map(batches?.map((b) => [b.id, b.name]) || []);

    // Group subjects by type and attach faculty information
    const theorySubjects = [];
    const practicalSubjects = [];

    subjects.forEach((subject) => {
      const assignments = facultySubjects.filter((fs) => fs.subject_id === subject.id);

      if (subject.type === "theory") {
        // Theory subjects have one faculty assignment
        const assignment = assignments[0];
        theorySubjects.push({
          id: subject.id,
          code: subject.subject_code,
          name: subject.name,
          faculty: assignment ? (facultyMap.get(assignment.faculty_id) || "Not assigned") : "Not assigned",
          faculty_id: assignment?.faculty_id || null,
        });
      } else if (subject.type === "practical") {
        // Practical subjects can have multiple batch assignments
        const batchFaculties = {};
        assignments.forEach((assignment) => {
          if (assignment.batch_id) {
            const batchName = batchMap.get(assignment.batch_id);
            if (batchName) {
              batchFaculties[batchName] = facultyMap.get(assignment.faculty_id) || "Not assigned";
            }
          }
        });

        practicalSubjects.push({
          id: subject.id,
          code: subject.subject_code,
          name: subject.name,
          faculties: batchFaculties,
          assignments: assignments.map((a) => ({
            batch_id: a.batch_id,
            batch_name: a.batch_id ? batchMap.get(a.batch_id) : null,
            faculty_id: a.faculty_id,
            faculty_name: a.faculty_id ? facultyMap.get(a.faculty_id) : "Not assigned",
          })),
        });
      }
    });

    res.json({
      success: true,
      subjects: {
        theory: theorySubjects,
        practical: practicalSubjects,
      },
    });
  } catch (err) {
    console.error("Error fetching subjects:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/subjects/assign", authenticateUser, authorizeRoles("class_teacher"),
  async (req, res) => {
    try {
      // Get class_id from token
      const classId = req.user.class_id;
      if (!classId) {
        return res.status(400).json({ success: false, error: "Missing class_id in token" });
      }

      // Get department_id from users table using class teacher's id
      const classTeacherId = req.user.id;
      const { data: classTeacher, error: userError } = await supabase
        .from("users")
        .select("department_id")
        .eq("id", classTeacherId)
        .single();

      if (userError || !classTeacher) {
        return res.status(400).json({ success: false, error: "Class teacher not found" });
      }

      const departmentId = classTeacher.department_id;
      if (!departmentId) {
        return res.status(400).json({ success: false, error: "Department ID not found for class teacher" });
      }

      // Get subject details from request body
      const {
        subject_code,
        subject_name,
        type, // 'theory' | 'practical'
        faculty_id, // for theory
        faculty_assignments, // array for practical: [{batch_id, faculty_id}]
      } = req.body;

      if (!subject_code || !subject_name || !type) {
        return res
          .status(400)
          .json({ success: false, error: "Missing required fields: subject_code, subject_name, type" });
      }

      if (type === "theory" && !faculty_id) {
        return res
          .status(400)
          .json({ success: false, error: "Faculty ID required for theory subject." });
      }

      if (type === "practical" && (!faculty_assignments || !Array.isArray(faculty_assignments) || faculty_assignments.length === 0)) {
        return res.status(400).json({
          success: false,
          error: "faculty_assignments array required for practical subjects.",
        });
      }

      // Create subject
      const { data: subjectData, error: subjectError } = await supabase
        .from("subjects")
        .insert([
          {
            name: subject_name,
            subject_code,
            type,
            department_id: departmentId,
            class_id: classId,
          },
        ])
        .select()
        .single();

      if (subjectError) throw subjectError;

      const subject_id = subjectData.id;

      // Create faculty assignments
      let insertData = [];

      if (type === "theory") {
        insertData.push({
          faculty_id,
          subject_id,
          batch_id: null,
          class_id: classId,
        });
      } else if (type === "practical") {
        for (const fa of faculty_assignments) {
          if (!fa.batch_id || !fa.faculty_id) {
            return res.status(400).json({
              success: false,
              error: "Each batch assignment must have batch_id and faculty_id.",
            });
          }

          insertData.push({
            faculty_id: fa.faculty_id,
            subject_id,
            batch_id: fa.batch_id,
            class_id: classId,
          });
        }
      }

      const { data: assignedData, error: assignError } = await supabase
        .from("faculty_subjects")
        .insert(insertData)
        .select();

      if (assignError) throw assignError;

      res.status(201).json({
        success: true,
        message:
          type === "theory"
            ? "Theory subject created and assigned successfully."
            : "Practical subject created and assigned to all batches successfully.",
        subject: subjectData,
        assignments: assignedData,
      });
    } catch (err) {
      console.error("Error assigning subject:", err);
      res.status(500).json({
        success: false,
        error: err.message || "Internal Server Error",
      });
    }
  }
);

// Delete subject
router.delete("/subjects/:id", authenticateUser, authorizeRoles("class_teacher"), async (req, res) => {
  try {
    const { id } = req.params;
    const classId = req.user.class_id;

    if (!classId) {
      return res.status(400).json({ success: false, error: "Missing class_id in token" });
    }

    // Verify subject belongs to this class
    const { data: subject, error: subjectError } = await supabase
      .from("subjects")
      .select("id, class_id")
      .eq("id", id)
      .single();

    if (subjectError || !subject) {
      return res.status(404).json({ success: false, error: "Subject not found" });
    }

    if (subject.class_id !== classId) {
      return res.status(403).json({ success: false, error: "Unauthorized to delete this subject" });
    }

    // Delete faculty_subjects first (cascade or manual)
    const { error: deleteFacultySubjectsError } = await supabase
      .from("faculty_subjects")
      .delete()
      .eq("subject_id", id);

    if (deleteFacultySubjectsError) {
      console.error("Error deleting faculty_subjects:", deleteFacultySubjectsError);
    }

    // Delete subject
    const { error: deleteError } = await supabase
      .from("subjects")
      .delete()
      .eq("id", id);

    if (deleteError) throw deleteError;

    res.status(200).json({ success: true, message: "Subject deleted successfully" });
  } catch (err) {
    console.error("Error deleting subject:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/create-batch", authenticateUser, authorizeRoles("class_teacher", "hod"), async (req, res) => {
  try {
    const { name, roll_start, roll_end, faculty_id } = req.body;
    const class_id = req.user.class_id; // from token

    if (!class_id) {
      return res.status(403).json({ success: false, error: "Class ID missing in token" });
    }

    if (!name || !roll_start || !roll_end || !faculty_id) {
      return res.status(400).json({ success: false, error: "All fields are required" });
    }

    // 1️⃣ Create batch
    const { data: batchData, error: batchError } = await supabase
      .from("batches")
      .insert([{ name, roll_start, roll_end, faculty_id, class_id }])
      .select()
      .single();

    if (batchError) {
      console.error("Batch insert error:", batchError);
      return res.status(500).json({ success: false, error: batchError.message });
    }

    const batch_id = batchData.id;

    // 2️⃣ Update students: assign them to this batch
    const { error: studentError } = await supabase
      .from("students")
      .update({ batch_id })
      .gte("roll_no", roll_start)
      .lte("roll_no", roll_end)
      .eq("class_id", class_id);

    if (studentError) {
      console.error("Student update error:", studentError);
      return res.status(500).json({ success: false, error: studentError.message });
    }

    // 3️⃣ Link faculty to batch in faculty_subjects
    const { error: facultySubError } = await supabase
      .from("faculty_subjects")
      .insert([{ faculty_id, class_id, batch_id }]);

    if (facultySubError) {
      console.error("Faculty_subject insert error:", facultySubError);
      // Non-critical error, but inform user
    }

    return res.status(200).json({
      success: true,
      message: "Batch created and faculty linked successfully",
      batch: batchData,
    });
  } catch (err) {
    console.error("Create batch error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/import-students", authenticateUser, authorizeRoles("class_teacher"),
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file)
        return res.status(400).json({ success: false, error: "No file uploaded" });

      const workbook = xlsx.readFile(req.file.path);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = xlsx.utils.sheet_to_json(sheet);

      if (!data.length)
        return res.status(400).json({ success: false, error: "Excel sheet is empty" });

      const required = ["roll_no", "name", "hall_ticket_number", "attendance_percent"];
      const missing = required.filter((c) => !Object.keys(data[0]).includes(c));
      if (missing.length)
        return res.status(400).json({
          success: false,
          error: `Missing required columns: ${missing.join(", ")}`,
        });

      const classId = req.user.class_id || req.body.class_id;
      if (!classId)
        return res
          .status(403)
          .json({ success: false, error: "class_id missing" });

      // Fetch existing students for that class
      const { data: existing, error: fetchError } = await supabase
        .from("students")
        .select("roll_no, hall_ticket_number")
        .eq("class_id", classId);

      if (fetchError) throw fetchError;

      const existingRolls = new Set(existing.map((s) => s.roll_no.toString().trim()));
      const existingHallTickets = new Set(
        existing.map((s) => s.hall_ticket_number.toString().trim())
      );

      // Filter out duplicates
      const newStudents = data.filter((s) => {
        const roll = s.roll_no?.toString().trim();
        const hall = s.hall_ticket_number?.toString().trim();
        return !existingRolls.has(roll) && !existingHallTickets.has(hall);
      });

      if (!newStudents.length) {
        fs.unlinkSync(req.file.path);
        return res.status(200).json({
          success: true,
          message: "No new students to import (all duplicates skipped).",
        });
      }

      // Prepare students for insert
      const students = newStudents.map((s) => {
        const attendance = Number(s.attendance_percent) || 0;
        const hallticket = String(s.hall_ticket_number).trim();
        const hash = bcrypt.hashSync(hallticket, 10);
        return {
          roll_no: String(s.roll_no).trim(),
          name: s.name.trim(),
          hall_ticket_number: hallticket,
          attendance_percent: attendance,
          defaulter: attendance < 75,
          class_id: classId,
          batch_id: null,
          password: hash,
        };
      });

      // Insert only unique new records
      const { error: insertError } = await supabase
        .from("students")
        .insert(students);

      if (insertError) throw insertError;

      fs.unlinkSync(req.file.path);

      res.status(200).json({
        success: true,
        message: `Import completed. ${students.length} new students added.`,
      });
    } catch (err) {
      console.error("Import error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);


export default router;
