import type { ClassRoom, Exam, ExamAssignment } from "../product-types";
import { classMembership, getExam, productJson, requireClassTeacher, type ProductUser } from "./product-auth";
import { HttpError, optionalText, requireText } from "./validation";

export async function managedClass(db: D1Database, id: string): Promise<ClassRoom> {
  const row = await db.prepare("SELECT data FROM product_classes WHERE id = ?").bind(id).first<{data:string}>();
  if (!row) throw new HttpError(404, "반을 찾을 수 없습니다.");
  return JSON.parse(row.data);
}
export function requireActiveClass(room: ClassRoom) {
  if (room.archivedAt) throw new HttpError(409, "보관한 반은 기록 열람만 가능합니다.", "CLASS_ARCHIVED");
}
export async function requireCurrentStudent(db: D1Database, classId: string, userId: string) {
  requireActiveClass(await managedClass(db,classId));
  if ((await classMembership(db,classId,userId))?.role !== "student") throw new HttpError(403, "현재 반에 소속된 학생만 자료를 수정하거나 대화를 보낼 수 있습니다.");
}
/** Both the preview and atomic departure use this policy. A payer is never reassigned implicitly. */
export async function departureBlockers(db: D1Database, userId: string): Promise<string[]> {
  const rows = await db.prepare("SELECT c.data FROM product_classes c JOIN product_members m ON c.id=m.class_id WHERE m.user_id=? AND m.role='teacher'").bind(userId).all<{data:string}>();
  const blocked: string[] = [];
  for (const row of rows.results) {
    const room: ClassRoom = JSON.parse(row.data);
    if (room.archivedAt) continue;
    const other = await db.prepare("SELECT user_id FROM product_members WHERE class_id=? AND role='teacher' AND user_id!=?").bind(room.id,userId).first();
    if (!other || room.billingTeacherId === userId) blocked.push(room.name);
  }
  return blocked;
}
export async function handleManagement(db: D1Database, path: string, body: Record<string,unknown>, user: ProductUser): Promise<Response|null> {
  const classRoute = path.match(/^classes\/([^/]+)\/(leave|remove|readmit|archive)$/);
  if (classRoute) {
    const [,id,operation] = classRoute, room = await managedClass(db,id);
    const member = await classMembership(db,id,user.id);
    if (!member) throw new HttpError(403,"참여한 반만 관리할 수 있습니다.");
    if (operation === "archive") {
      await requireClassTeacher(db,id,user.id);
      const updated = {...room,archivedAt:room.archivedAt ?? new Date().toISOString()};
      await db.prepare("UPDATE product_classes SET data=? WHERE id=? AND data=?").bind(JSON.stringify(updated),id,JSON.stringify(room)).run();
      return productJson({classroom:updated});
    }
    if (operation === "remove" || operation === "readmit") {
      await requireClassTeacher(db,id,user.id); requireActiveClass(room);
      const studentId = requireText(body.studentId,"학생",100);
      if (operation === "readmit") {
        await db.prepare("DELETE FROM product_departures WHERE class_id=? AND user_id=? AND status='removed'").bind(id,studentId).run();
        return productJson({ok:true});
      }
      if ((await classMembership(db,id,studentId))?.role !== "student") throw new HttpError(404,"현재 반의 학생을 선택하세요.");
      await db.batch([
        db.prepare("INSERT INTO product_departures (class_id,user_id,status,created_at) VALUES (?,?,'removed',?) ON CONFLICT(class_id,user_id) DO UPDATE SET status='removed',created_at=excluded.created_at").bind(id,studentId,new Date().toISOString()),
        db.prepare("DELETE FROM product_members WHERE class_id=? AND user_id=? AND role='student'").bind(id,studentId),
      ]);
      return productJson({ok:true});
    }
    const removed = await db.batch([
      db.prepare("DELETE FROM product_members WHERE class_id=? AND user_id=? AND (role='student' OR EXISTS (SELECT 1 FROM product_classes c WHERE c.id=? AND (json_extract(c.data,'$.archivedAt') IS NOT NULL OR (json_extract(c.data,'$.billingTeacherId')!=? AND (SELECT COUNT(*) FROM product_members m WHERE m.class_id=? AND m.role='teacher')>1))))").bind(id,user.id,id,user.id,id),
      db.prepare("INSERT INTO product_departures (class_id,user_id,status,created_at) SELECT ?,?,'left',? WHERE NOT EXISTS (SELECT 1 FROM product_members WHERE class_id=? AND user_id=?) ON CONFLICT(class_id,user_id) DO UPDATE SET status='left',created_at=excluded.created_at").bind(id,user.id,new Date().toISOString(),id,user.id),
    ]);
    if (!removed[0].meta.changes) throw new HttpError(409,"다른 담당 선생님이 비용 부담을 수락하고 담당을 이어받아야 합니다. 운영을 마친 반은 먼저 보관하세요.","CLASS_HANDOVER_REQUIRED");
    return productJson({ok:true});
  }
  const examRoute = path.match(/^exams\/([^/]+)\/(archive|restore|delete)$/);
  if (examRoute) {
    const [,id,operation]=examRoute, exam=await getExam(db,id);
    if (exam.ownerId !== user.id || exam.legacyId) throw new HttpError(403,"본인이 등록한 시험만 관리할 수 있습니다.");
    if (exam.classId) await requireClassTeacher(db,exam.classId,user.id);
    if (body.revision !== exam.revision) throw new HttpError(409,"최신 시험을 불러오세요.","REVISION_CONFLICT");
    if (operation === "delete") {
      // A logical tombstone preserves file references, requests, assignments and all result snapshots.
      const used=await db.prepare("SELECT id FROM product_assignments WHERE exam_id=? UNION ALL SELECT id FROM product_submissions WHERE json_extract(data,'$.exam.id')=? UNION ALL SELECT id FROM product_contributions WHERE source_exam_id=? LIMIT 1").bind(id,id,id).first();
      if (used) throw new HttpError(409,"배정·제출·기여에 사용된 시험은 삭제 대신 보관하세요.","EXAM_IN_USE");
    }
    const updated:Exam={...exam,revision:exam.revision+1,archivedAt:operation === "restore" ? undefined : new Date().toISOString(),deletedAt:operation === "delete" ? new Date().toISOString() : exam.deletedAt};
    if (exam.deletedAt) throw new HttpError(409,"삭제한 시험은 변경할 수 없습니다.");
    const write=await db.prepare("UPDATE product_exams SET data=?,revision=? WHERE id=? AND revision=? AND (?!='delete' OR (NOT EXISTS (SELECT 1 FROM product_assignments a WHERE a.exam_id=product_exams.id) AND NOT EXISTS (SELECT 1 FROM product_submissions s WHERE json_extract(s.data,'$.exam.id')=product_exams.id) AND NOT EXISTS (SELECT 1 FROM product_contributions c WHERE c.source_exam_id=product_exams.id)))").bind(JSON.stringify(updated),updated.revision,id,exam.revision,operation).run();
    if (!write.meta.changes) throw new HttpError(409,"시험이 변경되었습니다.","REVISION_CONFLICT");
    return productJson({exam:updated});
  }
  const assignmentRoute=path.match(/^assignments\/([^/]+)\/(settings|cancel)$/);
  if (assignmentRoute) {
    const [,id,operation]=assignmentRoute;
    const row=await db.prepare("SELECT data FROM product_assignments WHERE id=?").bind(id).first<{data:string}>();
    if (!row) throw new HttpError(404,"과제를 찾을 수 없습니다.");
    const assignment:ExamAssignment=JSON.parse(row.data);
    await requireClassTeacher(db,assignment.classId,user.id); requireActiveClass(await managedClass(db,assignment.classId));
    if (body.revision !== (assignment.revision ?? 1)) throw new HttpError(409,"과제가 변경되었습니다.","REVISION_CONFLICT");
    if (assignment.cancelledAt) throw new HttpError(409,"배정이 취소된 과제입니다.","ASSIGNMENT_CANCELLED");
    const due=optionalText(body.dueAt,"마감일",100);
    if (due && !Number.isFinite(Date.parse(due))) throw new HttpError(400,"마감일을 확인하세요.");
    const updated:ExamAssignment={...assignment,revision:(assignment.revision ?? 1)+1,...(operation === "cancel" ? {cancelledAt:new Date().toISOString()} : {title:requireText(body.title,"과제 이름",200),dueAt:due ? new Date(due).toISOString() : null})};
    const write=await db.prepare("UPDATE product_assignments SET data=? WHERE id=? AND data=?").bind(JSON.stringify(updated),id,row.data).run();
    if (!write.meta.changes) throw new HttpError(409,"과제가 변경되었습니다.","REVISION_CONFLICT");
    return productJson({assignment:updated});
  }
  return null;
}
