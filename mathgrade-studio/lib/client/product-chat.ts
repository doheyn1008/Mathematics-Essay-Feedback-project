import type { ExamMessage } from "../product-types";

export type MessagePage={messages:ExamMessage[];cursor:string;hasMore:boolean};
export function mergeMessages(current:ExamMessage[],incoming:ExamMessage[]) {
  return [...new Map([...current,...incoming].map(m=>[m.id,m])).values()].sort((a,b)=>(a.sequence??0)-(b.sequence??0)||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
}
/** Only conversation data is refreshed. Lifecycle and network primitives are injectable for regression tests. */
export function startMessagePolling({load,receive,status,visible=()=>true,schedule=setTimeout,cancel=clearTimeout}:{load:(cursor:string,signal:AbortSignal)=>Promise<MessagePage>;receive:(messages:ExamMessage[])=>void;status:(message:string)=>void;visible?:()=>boolean;schedule?:typeof setTimeout;cancel?:typeof clearTimeout}) {
  let stopped=false,inflight=false,cursor="",delay=3000,timer:ReturnType<typeof setTimeout>|undefined;
  let controller:AbortController|null=null;
  async function poll() {
    if (stopped||inflight) return;
    if (timer!==undefined) cancel(timer);
    if (!visible()) {timer=schedule(()=>void poll(),3000);return;}
    inflight=true;controller=new AbortController();
    try {
      let more=true;
      while(more&&!stopped) {
        const page=await load(cursor,controller.signal);
        if(stopped)return;
        receive(page.messages);status("대화 자동 갱신 중");
        more=page.hasMore&&page.cursor!==cursor;cursor=page.cursor;
      }
      delay=3000;
    } catch(error) {
      if(stopped)return;
      const code=(error as {status?:number}).status;
      if(code===401||code===403||code===404){status("대화 접근 권한이 변경되었습니다. 기록을 다시 확인하세요.");stopped=true;return;}
      status("연결 복구 중 · 작성한 내용은 유지됩니다.");delay=Math.min(30000,delay*2);
    } finally {inflight=false;if(!stopped)timer=schedule(()=>void poll(),delay);}
  }
  void poll();
  return {wake:()=>{if(!stopped&&!inflight)void poll();},stop:()=>{stopped=true;if(timer!==undefined)cancel(timer);controller?.abort();}};
}
