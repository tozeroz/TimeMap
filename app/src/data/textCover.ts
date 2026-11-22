/** Stable for the same post across the square and nearby list. */
export function textCoverVariant(id:string):number {
  return Array.from(id).reduce((hash,char)=>(hash*31+char.charCodeAt(0))>>>0,0)%3
}
