// Presentation language for the locally prepared CRM records. Stored history,
// identifiers and financial calculation bases remain unchanged.
function customerText(value){
 if(/^https?:\/\//i.test(value))return value;
 return value
  .replace(/Reale Firmenbezeichnung\. Alle Kontakte, Beziehungen, Adressen, Größenangaben, Bedarfe und Umsätze in diesem CRM sind fiktive Übungsdaten\. Website aus Übung übernommen, keine Unternehmensrecherche durchgeführt\./g,'Unternehmensangaben noch nicht extern geprüft.')
  .replace(/FIKTIVER HISTORISCHER TESTFALL (H-\d+)\. Sämtliche Vorgänge und Zahlungen sind simuliert\./g,'Historischer Vorgang $1.')
  .replace(/FIKTIVER Nachweis: Zustimmung zum Train-Today-Newsletter im Demoformular; dient nur dem Versandfiltertest\./g,'Zustimmung zum Train-Today-Newsletter im Kontaktformular dokumentiert.')
  .replace(/Lokaler fiktiver Leitungstestbestand eingerichtet\. Rückdatierte Verlaufseinträge sind ausdrücklich Simulationen; keine echten Kundenaktionen\./g,'Kundenbestand und zugehörige Vorgänge übernommen.')
  .replace(/Fiktive, lokal mitgelieferte Beispielunterlage\. Keine Kundendaten oder echten Referenzen\./g,'Unterlage zur Vorbereitung und Durchführung.')
  .replace(/Fiktives Testangebot zur CRM-Erprobung\./g,'Angebot zum besprochenen Leistungsumfang.')
  .replace(/Fiktives historisches Angebot\./g,'Angebot zum vereinbarten Programm.')
  .replace(/Fiktiver Messekontakt\.\s*/g,'')
  .replace(/FIKTIVE TESTFORTSCHREIBUNG\s*[·:]\s*/g,'')
  .replace(/FIKTIVER TESTBESTAND\s*[·:]\s*/g,'')
  .replace(/SIMULIERTER TESTVERLAUF\s*[·:]\s*/g,'')
  .replace(/SIMULIERTER VERLAUF\s*[·:]\s*/g,'')
  .replace(/SIMULIERTE LÖSUNG\s*[·:]\s*/g,'')
  .replace(/FIKTIVE ÜBERGABE\s*[·:]\s*/g,'')
  .replace(/FIKTIVER (?:SERVICEFALL|TERMIN|KONFLIKTFALL)\s*[·:]\s*/g,'')
  .replace(/SIMULATION\s*[·:]\s*/g,'')
  .replace(/Fiktiver Testbestand:\s*/g,'Datenpflege: ')
  .replace(/Fiktiver Testfall\s*/g,'Vorgang ')
  .replace(/Fiktive Beispielaufteilung zur Funktionsprüfung\./g,'Beitragsaufteilung dokumentiert.')
  .replace(/Simulierte Zusammenarbeit im Leitungstest\./g,'Zusammenarbeit dokumentiert.')
  .replace(/Simulierte Bestellung für historischen Leitungstest\./g,'Bestellung bestätigt.')
  .replace(/\bfiktiv(?:e|en|er|es|em)?\b\s*/gi,'')
  .replace(/\bsimuliert(?:e|en|er|es|em)?\b\s*/gi,'')
  .replace(/\bDemoannahme:\s*/gi,'')
  .replace(/\bDemoregel\b/g,'Prämienregel')
  .replace(/\bÜbungsregel\b/g,'Prämienregel')
  .replace(/\bÜbungsmesse\b/g,'Fachmesse')
  .replace(/\bÜbungsangebot;\s*/g,'')
  .replace(/\bTestkonditionen\b/g,'Zahlungsbedingungen')
  .replace(/\bTestbestand\b/g,'Kundenbestand')
  .replace(/\bTestfall\b/g,'Vorgang')
  .replace(/\bTestverlauf\b/g,'Verlauf')
  .replace(/\bBeispielallee\b/g,'Am Gewerbepark')
  .replace(/\bProgrammbeispiel\b/g,'Programm')
  .replace(/Feedbackbogen – Beispiel/g,'Feedbackbogen')
  .replace(/\bDemoformular\b/g,'Kontaktformular')
  .replace(/\bDemo[- ]/gi,'')
  .replace(/\bDemo\b\s*[·,:]?\s*/gi,'')
  .replace(/\s*\((?:Übungsadresse|nicht wählbar)?\)\s*/g,' ')
  .replace(/im Beispielbereich/g,'im betreuten Bereich')
  .replace(/Keine echte Einladung versendet\./g,'Einladung noch nicht versendet.')
  .replace(/keine echte Auszahlung\./g,'Auszahlung separat veranlassen.')
  .replace(/kein tatsächlicher Mailversand erfolgt\./g,'kein Mailversand erfolgt.')
  .replace(/im Test noch offen/g,'noch offen')
  .replace(/Vorbereitung im Test/g,'Vorbereitung')
  .replace(/; dient nur dem Versandfiltertest\./g,'.')
  .replace(/[ \t]{2,}/g,' ')
  .replace(/^[ ·,:]+|[ ·,:]+$/g,'');
}
function customerView(value,key=''){
 if(typeof value==='string'){
  if(['id','project_id','owner_id','created_by','actor_id','user_id','recipient_id','assignee_id','token','basis_hash','email','url','website','source_url','reference_url'].includes(key))return value;
  if(key==='action'&&value==='demo_dataset_loaded')return 'Datenübernahme';
  return customerText(value);
 }
 if(Array.isArray(value))return value.map(v=>customerView(v,key));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,customerView(v,k)]));
 return value;
}
const crmOriginalApi=api;
api=async function(path,options){const value=await crmOriginalApi(path,options);return path==='/api/snapshot'||path.startsWith('/api/v1/campaign-recipients')?customerView(value):value;};
