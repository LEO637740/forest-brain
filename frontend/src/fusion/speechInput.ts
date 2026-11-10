export type SpeechState={status:'idle'|'listening'|'processing'|'ready'|'error';message:string;transcript:string};
type RecognitionResult=ArrayLike<{transcript:string}> & {isFinal:boolean};
export type BrowserRecognition={lang:string;continuous:boolean;interimResults:boolean;onstart:(()=>void)|null;onend:(()=>void)|null;onerror:((event:{error:string})=>void)|null;onresult:((event:{resultIndex:number;results:ArrayLike<RecognitionResult>})=>void)|null;start:()=>void;stop:()=>void;abort:()=>void};
export type RecognitionConstructor=new()=>BrowserRecognition;
export const speechError=(code:string)=>({
 'not-allowed':'未获得麦克风权限，请在浏览器设置中允许访问。',
 'service-not-allowed':'浏览器未允许语音识别服务，请继续键盘输入。',
 'audio-capture':'没有可用麦克风，请检查输入设备。',
 'no-speech':'没有识别到语音，请再试一次。',
 network:'语音服务连接失败，请重试或键盘输入。',
 aborted:'语音输入已取消，原文字保留。',
 'language-not-supported':'当前浏览器语音服务不支持中文，请继续键盘输入。',
}[code]??'语音识别未完成，请重试或继续键盘输入。');

// The controller never receives a send callback: recognition only returns text.
export function createSpeechInput(Ctor:RecognitionConstructor,onState:(state:SpeechState)=>void,onText:(text:string)=>void){
 let recognition:BrowserRecognition|null=null,settled=false,failed=false,parts:string[]=[];
 const report=(status:SpeechState['status'],message:string)=>onState({status,message,transcript:parts.join(' ').trim()});
 return {
  start(){
   if(recognition)return;
   settled=false;failed=false;parts=[];
   try{
    const r=new Ctor();recognition=r;r.lang='zh-CN';r.continuous=false;r.interimResults=true;
    r.onstart=()=>report('listening','正在聆听…');
    r.onresult=e=>{for(let i=e.resultIndex;i<e.results.length;i++)parts[i]=e.results[i][0]?.transcript??'';report('listening','正在聆听…');};
    r.onerror=e=>{failed=true;report('error',speechError(e.error));};
    r.onend=()=>{recognition=null;if(settled||failed)return;settled=true;const text=parts.join(' ').trim();if(text){onText(text);report('ready','');}else report('error',speechError('no-speech'));};
    report('listening','正在打开麦克风…');r.start();
   }catch{recognition=null;failed=true;report('error','无法启动浏览器语音识别，请继续键盘输入。');}
  },
  stop(){if(recognition){report('processing','正在识别…');recognition.stop();}},
  cancel(){settled=true;if(recognition){const r=recognition;recognition=null;r.onstart=null;r.onresult=null;r.onerror=null;r.onend=null;r.abort();}},
 };
}
