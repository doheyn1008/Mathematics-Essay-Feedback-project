import type { Question, Review, WorkspaceState } from "@/lib/types";

const createdAt = "2026-11-16T00:00:00.000Z";
export const demoQuestion: Question = {
  id: "demo-question", ownerId: "demo-teacher", academyId: "demo-academy", revision: 1,
  title: "닫힌 구간에서의 최댓값과 최솟값", prompt: "닫힌 구간 [0, 3]에서 함수 f(x) = x³ − 3x² + 2의 최댓값과 최솟값을 구하고, 각 값을 갖는 모든 x를 풀이와 함께 쓰시오.",
  university: "", department: "", examKey: "", academicYear: null,
  sourceUrl: "", sourceLabel: "수식채점실 자체 제작 예시", notes: "f(x)−2=x²(x−3)≤0, f(x)+2=(x−2)²(x+1)≥0과 같은 대안 풀이도 인정합니다.",
  criteria: [
    {id:"c1",title:"판정 근거와 후보 확인",max:4,description:"도함수 2점, 구간 양 끝점과 내부 임계점 확인 2점. 타당한 대안 풀이도 인정합니다."},
    {id:"c2",title:"함수값의 계산과 비교",max:3,description:"세 후보의 함수값을 비교하거나 상한과 하한을 증명합니다."},
    {id:"c3",title:"최댓값·최솟값과 모든 위치",max:3,description:"최댓값과 최솟값 각 1점, 해당하는 x를 모두 명시하면 1점."},
  ], createdAt,
};
const review: Review = {scores:[4,3,2],evidence:["도함수와 후보 x = 0, 2, 3을 모두 정확히 구했습니다.","f(0) = 2, f(2) = −2, f(3) = 2가 모두 정확합니다.","최댓값을 갖는 위치에서 x = 3이 빠졌습니다. (−1점)"],feedback:"후보의 함수값을 정확히 계산했어요. 최댓값 2는 x = 0과 x = 3에서 모두 나오므로 두 위치를 함께 적어 주세요.",questionResponse:"아니요. 문제에서 모든 위치를 요구하므로 최댓값을 갖는 x = 0과 x = 3을 모두 적어야 합니다.",reviewerId:"demo-teacher",reviewedAt:createdAt};

export function createDemoState(): WorkspaceState {
  const question = structuredClone(demoQuestion);
  const answer = "f′(x) = 3x(x − 2)\n후보는 x = 0, 2, 3이다.\n\nf(0) = 2, f(2) = −2, f(3) = 2\n\n최댓값은 2 (x = 0),\n최솟값은 −2 (x = 2)이다.";
  return {
    user:{id:"demo-teacher",name:"예시 선생님",email:""},
    academies:[{id:"demo-academy",name:"수학 연구반",ownerId:"demo-teacher",joinCode:"DEMO24",createdAt}],
    memberships:[{academyId:"demo-academy",userId:"demo-student"}],questions:[question],
    assignments:[{id:"demo-assignment",academyId:"demo-academy",title:"미분 서술형 주간 과제",question,dueAt:null,createdAt}],
    submissions:[
      {id:"demo-a",studentId:"demo-student",studentCode:"A-001",academyId:"demo-academy",assignmentId:"demo-assignment",mode:"academy",question,answer,studentQuestion:"최댓값이 같으면 x를 하나만 적어도 되나요?",problemAttachment:null,attachment:null,status:"draft",draft:structuredClone(review),final:null,revision:1,createdAt,updatedAt:createdAt},
      {id:"demo-b",studentId:"demo-student-b",studentCode:"A-002",academyId:"demo-academy",assignmentId:"demo-assignment",mode:"academy",question,answer:"0 ≤ x ≤ 3이면\nf(x) − 2 = x²(x − 3) ≤ 0\nf(x) + 2 = (x − 2)²(x + 1) ≥ 0\n\n따라서 최댓값은 2 (x = 0, 3),\n최솟값은 −2 (x = 2)이다.",attachment:null,status:"approved",draft:null,final:{...review,scores:[4,3,3],evidence:["인수분해를 이용해 함수값의 범위를 판단했습니다.","두 부등식의 방향이 올바릅니다.","등호가 성립하는 위치를 모두 적었습니다."],feedback:"함수값의 범위를 직접 증명하고 등호 성립 위치를 모두 확인했어요."},revision:1,createdAt,updatedAt:createdAt},
      {id:"demo-c",studentId:"demo-student-c",studentCode:"A-003",academyId:"demo-academy",assignmentId:"demo-assignment",mode:"academy",question,answer:"f′(x) = 3x(x − 2)\nx = 2에서 f(2) = −2\n\n따라서 최솟값은 −2이다.",attachment:null,status:"pending",draft:null,final:null,revision:1,createdAt,updatedAt:createdAt},
    ],admissions:[],sharedQuestions:[],points:{balance:0,events:[]},usage:{limit:3,used:0,remaining:3,day:"2026-11-16"},ai:{configured:false},storageReady:true,
  };
}
