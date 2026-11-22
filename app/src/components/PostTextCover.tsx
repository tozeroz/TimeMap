import {textCoverVariant} from '../data/textCover'
import './posttextcover.css'

export function PostTextCover({id,text,compact=false}:{id:string;text:string;compact?:boolean}){
  return <div className={`post-text-cover post-text-cover--${textCoverVariant(id)} ${text.length<=45?'post-text-cover--short':''} ${compact?'post-text-cover--compact':''}`} data-text-cover-id={id}>
    <div className="square-card__paper"><p>{text||'一段校园回忆'}</p><svg viewBox="0 0 140 35" fill="none" aria-hidden="true"><path d="M3 23q22 18 46 0m8 3q18-25 39-12" stroke="currentColor" strokeWidth="1"/><path d="m109 26 19-22-4 15-15 7 2-14 17-8m-19 22-6 6" stroke="#ed6536" strokeWidth="1.5"/></svg></div>
  </div>
}
