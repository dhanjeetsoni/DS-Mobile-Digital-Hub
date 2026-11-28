/** A camera session owns precisely one successful scan; stale async work is ignored. */
export class ScanLifecycle{
 private generation=0;private open=false;
 get token(){return this.generation;}
 begin(){this.generation++;this.open=true;return this.generation;}
 isCurrent(token:number){return this.open&&token===this.generation;}
 finish(token:number){if(!this.isCurrent(token))return false;this.open=false;return true;}
 cancel(){this.open=false;this.generation++;}
}
