import{Component,inject,signal}from'@angular/core';import{FormsModule}from'@angular/forms';import{ActivatedRoute,RouterLink}from'@angular/router';
type DetailState='default'|'disabled'|'loading'|'error';type Decision=''|'APPROVED'|'REJECTED';
@Component({selector:'app-review-detail',imports:[FormsModule,RouterLink],templateUrl:'./review-detail.html',styleUrl:'./review-detail.scss'})
export class ReviewDetail{
 private readonly route=inject(ActivatedRoute);readonly productId=this.route.snapshot.paramMap.get('id')??'102';readonly stateOptions:readonly DetailState[]=['default','disabled','loading','error'];readonly pageState=signal<DetailState>('default');readonly selectedRisks=signal<string[]>([]);readonly decision=signal<Decision>('');readonly comment=signal('');readonly otherNote=signal('');readonly submitted=signal(false);readonly conflictOpen=signal(false);readonly statusMessage=signal('');
 readonly product={name:this.productId==='103'?'無香低敏濃縮洗衣紙補充組':'輕量智慧溫控電熱杯',category:this.productId==='103'?'日用品':'3C／家電',pricingType:this.productId==='103'?'RESALE':'NEW',completeness:this.productId==='103'?88:78,baseScore:this.productId==='103'?72.8:78.4,festivalBoost:3.3,finalScore:this.productId==='103'?76.1:81.7,audience:84,trend:86,submissionCount:this.productId==='103'?2:1,aiSummary:'市場熱度與核心客群具中高度匹配，但仍需人工確認供貨穩定性與實際商業條件。',previousComment:'上次因備援供應方案不足而未通過，請確認本次補件。'};
 readonly riskOptions=['實際供貨風險','商品品質與客訴風險','市場不確定性與需求變動風險','其他'];
 setState(s:DetailState):void{this.pageState.set(s);this.statusMessage.set(`已切換為 ${s} 狀態。`);}
 toggleRisk(risk:string):void{this.selectedRisks.update(items=>items.includes(risk)?items.filter(i=>i!==risk):[...items,risk]);}
 submit():void{if(!this.decision()){this.statusMessage.set('請選擇核准結果。');return;}if(this.selectedRisks().includes('其他')&&!this.otherNote().trim()){this.statusMessage.set('選擇「其他」風險時必須填寫備註。');return;}if(!this.comment().trim()){this.statusMessage.set('請填寫本次審核留言與決策依據。');return;}this.submitted.set(true);this.statusMessage.set(`已在本地模擬${this.decision()==='APPROVED'?'通過':'不通過'}決策。`);}
 simulateConflict():void{this.conflictOpen.set(true);this.statusMessage.set('模擬 409 Conflict：此品項已由其他管理人員審核。');}
 closeConflict():void{this.conflictOpen.set(false);}
 retry():void{this.pageState.set('default');this.statusMessage.set('已恢復審核資料。');}
}
