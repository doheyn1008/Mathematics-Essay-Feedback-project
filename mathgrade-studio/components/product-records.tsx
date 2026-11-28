"use client";
import { ChevronRight, FileText } from "lucide-react";
import type { ExamSubmission } from "@/lib/product-types";
import { formatDate, formatFeedbackScore, resultStatus } from "./product-detail";

export const recordExamKey = (item: ExamSubmission) => item.assignmentId ? `assignment:${item.assignmentId}` : `exam:${item.exam.id}`;
export function RecordBrowser({ records,teacher,selected,onSelect,onOpen,busy }: {records:ExamSubmission[];teacher:boolean;selected:string;onSelect:(key:string)=>void;onOpen:(id:string)=>void;busy:boolean}) {
  const groups = new Map<string,ExamSubmission[]>();
  for (const item of records) {const key=recordExamKey(item);groups.set(key,[...(groups.get(key)??[]),item]);}
  const chosen = groups.get(selected);
  return <div className="p-records">{selected&&<div className="p-card-heading"><button className="button ghost small" onClick={()=>onSelect("")}>← 시험 목록</button><h2>{chosen?.[0]?.exam.title??"선택한 시험"}</h2><p>{teacher?"학생을 선택해 첨삭 내용을 확인하세요.":"제출 기록을 선택하세요."}</p></div>}{!selected?Array.from(groups,([key,entries])=><button className="p-record" key={key} onClick={()=>onSelect(key)}><span className="p-record-icon"><FileText size={22}/></span><span className="p-record-main"><strong>{entries[0].exam.title}</strong><small>{teacher?`${new Set(entries.map(e=>e.studentId)).size}명 · `:""}{entries.length}개 제출 기록 · 최근 {formatDate(entries[0].createdAt)}</small></span><ChevronRight size={17}/></button>):chosen?.map((item,index)=><button className="p-record" key={item.id} disabled={busy} onClick={()=>onOpen(item.id)}><span className="p-small-avatar">{item.studentName.slice(0,1)}</span><span className="p-record-main"><strong>{teacher?item.studentName:`제출 ${chosen.length-index}`}</strong><small>{formatDate(item.createdAt)}{chosen.filter(e=>e.studentId===item.studentId).length>1?` · 제출 기록 ${chosen.filter(e=>e.studentId===item.studentId).findIndex(e=>e.id===item.id)+1}`:""}</small></span><span className="p-badge">{resultStatus(item)}</span><RecordScores item={item} teacher={teacher} /><ChevronRight size={17}/></button>)}{selected&&!chosen&&<p className="p-card-body">검색 조건에 맞는 제출 기록이 없습니다.</p>}</div>;
}

function RecordScores({ item, teacher }: { item: ExamSubmission; teacher: boolean }) {
  const latest = item.latestVersion?.result;
  if (!teacher || item.firstFeedbackScore === undefined) {
    return <span className="p-record-score">{latest ? `${latest.total} / ${latest.maximum}` : "—"}</span>;
  }
  return <span className="p-record-score-pair">
    <span><small>1차 첨삭</small><strong>{formatFeedbackScore(item.firstFeedbackScore) ?? "첨삭 대기"}</strong></span>
    <span><small>최신 점수</small><strong>{formatFeedbackScore(latest) ?? "—"}</strong></span>
  </span>;
}
