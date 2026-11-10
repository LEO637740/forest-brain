import {useEffect,useRef,useState} from 'react';
import {Mic,Square,LoaderCircle} from 'lucide-react';
import {createSpeechInput,type RecognitionConstructor,type SpeechState} from './speechInput';


export function AssistantVoiceInput({disabled,onText,onActive}:{disabled:boolean;onText:(text:string)=>void;onActive:(active:boolean)=>void}){
 const [state,setState]=useState<SpeechState>({status:'idle',message:'',transcript:''});
 const Ctor=(window as unknown as {SpeechRecognition?:RecognitionConstructor;webkitSpeechRecognition?:RecognitionConstructor}).SpeechRecognition??(window as unknown as {webkitSpeechRecognition?:RecognitionConstructor}).webkitSpeechRecognition;
 const callbacks=useRef({onText,onActive});callbacks.current={onText,onActive};
 const controller=useRef<ReturnType<typeof createSpeechInput>|null>(null);
 const active=state.status==='listening'||state.status==='processing';
 useEffect(()=>{if(Ctor)controller.current=createSpeechInput(Ctor,s=>{setState(s);callbacks.current.onActive(s.status==='listening'||s.status==='processing')},text=>callbacks.current.onText(text));return()=>{controller.current?.cancel();callbacks.current.onActive(false);controller.current=null}},[Ctor]);
 const label=state.status==='processing'?'正在识别':active?'结束语音':'语音输入';
 return <>
  <button className="assistant-mic" type="button" title={label} aria-label={label} disabled={disabled||state.status==='processing'} aria-pressed={active} onClick={()=>{if(!Ctor){setState({status:'error',message:'此浏览器不支持语音输入，请使用键盘输入。',transcript:''});return;}active?controller.current?.stop():controller.current?.start();}}>
   {state.status==='processing'?<LoaderCircle size={20} className="spin"/>:active?<Square size={18}/>:<Mic size={20}/>}
  </button>
  {(active||state.status==='error')&&<span className="assistant-voice-feedback" role="status">{active&&state.transcript?state.transcript:state.message}</span>}
 </>;
}
