// Kundenanpassung 29.10.2026: Portal ersetzt Slack/Notion; lokale HR-Akte statt Personio.
// Quelle: Train-Today-Onboarding-Checklists.pdf, Seiten 1–2.
// Fristen sind Prototyp-Annahmen, soweit die Quelle keine Frist nennt.
const make=(id,title,owner,offset,mode,reason,extra={})=>({id,title,owner,offset,mode,reason,...extra});
export const catalog=[
 make('G01','Pflichtangaben auf Vollständigkeit prüfen','HR',-5,'AUTO','Feste Pflichtfelder und Formatregeln lassen sich zuverlässig prüfen.'),
 make('G02','HR-Akte und Stammdaten prüfen','HR',-3,'HITL','HR prüft Vertragsart, Urlaubstage und personenbezogene Angaben.',{needs:['Adresse','Vertragsart','Urlaubstage','Notfallkontakt'],details:'Vollständiger Name, Adresse, private und geschäftliche E-Mail, Abteilung, Rolle, Führungskraft, Startdatum, Vertragsart, Urlaubstage, Notfallkontakt.'}),
 make('G03','Lebenslauf in der HR-Akte hinterlegen','HR',-3,'HITL','Dokument und Zielakte müssen von HR geprüft werden.'),
 make('G04','Vertrag in der HR-Akte hinterlegen','HR',-3,'HITL','Vertragsdokumente bleiben im kontrollierten HR-Prozess.'),
 make('G05','Firmen-E-Mail und benötigtes Mailkonto bei IT anfordern','IT',-2,'HITL','IT bestätigt Identität, Konto und Berechtigungen.'),
 make('G06','Mitarbeiterportal-Zugang anfordern','IT',-2,'HITL','Zugriffsvergabe braucht eine verantwortliche Freigabe.'),
 make('G07','Persönlichen Workspace und Dokumentbereich freigeben','IT',-2,'HITL','Nur erforderliche Bereiche freigeben.'),
 make('G08','Mitarbeiterrolle und Zugriff auf eigene HR-Daten prüfen','IT',-2,'HITL','Kein automatischer HR- oder Administratorzugriff.'),
 make('G09','NordPass-Zugang anfordern','IT',-2,'HITL','Zugriff auf Passwörter muss kontrolliert werden.'),
 make('G10','voiio-Zugang beim Account Manager anfordern','HR',-2,'HITL','Empfänger und geschäftliche E-Mail vor Versand prüfen.'),
 make('G11','DataGuard-Zugang beim Account Manager anfordern','HR',-2,'HITL','Empfänger und geschäftliche E-Mail vor Versand prüfen.'),
 make('G12','Willkommenspaket an die Privatadresse schicken','HR',-3,'HUMAN','Physischer Versand und Adressprüfung bleiben menschlich.',{details:'Mousepad, Lanyard, Sticker und Willkommensbrief.'}),
 make('G13','Willkommens-E-Mail mit Informationen zum ersten Tag','HR',-2,'HITL','KI erstellt einen Entwurf; HR prüft Ort, Uhrzeit und Inhalt.'),
 make('G14','Führungskraft über den Onboarding-Start informieren','HR',-3,'HOTL','Standardisierte Statusmeldung kann nach Freigabe überwacht automatisiert werden.'),
 make('G15','Vorstellung am ersten Tag im Mitarbeiterportal vorbereiten','HR',0,'HITL','Inhalt und Freigabe zur Vorstellung vorher abstimmen.'),
 make('G16','Willkommenstermin mit HR und CEO am ersten Tag','HR',0,'HITL','Kalenderverfügbarkeit und persönliche Teilnahme abstimmen.'),
 make('G17','IT-Security-Awareness-Schulung planen','IT',2,'HOTL','Standardisierte Pflichtschulung mit überwachten Ausnahmen.'),
 make('G18','Code-of-Conduct- und Compliance-Schulung planen','HR',2,'HOTL','Standardisierte Pflichtschulung; Abschluss muss nachgewiesen werden.'),
 make('G19','Vollständigkeit vor Ende der ersten Woche bestätigen','HR',4,'HITL','Ein Aufgabenplan beweist keine erledigten Aufgaben.'),
 make('G20','Check-in nach einer Woche vereinbaren','HR',5,'HUMAN','Persönliches Gespräch über den Einstieg.'),
 make('M01','HubSpot Marketing Hub anfordern','Head of Marketing',-1,'HITL','Lizenz und Berechtigungsumfang prüfen.',{marketing:true}),
 make('M02','Canva-Pro-Lizenz anfordern','Head of Marketing',-1,'HITL','Lizenzkosten und Bedarf bestätigen.',{marketing:true}),
 make('M03','Buffer-Zugang anfordern','Head of Marketing',-1,'HITL','Veröffentlichungsrechte gezielt vergeben.',{marketing:true}),
 make('M04','Google-Ad-Manager-Zugang anfordern','Head of Marketing',-1,'HITL','Werbekonten und Budgetrechte kontrollieren.',{marketing:true}),
 make('M05','Marketing-Tresor in NordPass freigeben','IT',-1,'HITL','Sensible Zugangsdaten erfordern Freigabe.',{marketing:true}),
 make('M06','Marketing-Teamzuordnung im Mitarbeiterportal bestätigen','IT',-1,'HOTL','Standardzuordnung nach bestätigter Abteilung.',{marketing:true}),
 make('M07','Vorstellung beim Head of Marketing am ersten Tag','Head of Marketing',0,'HUMAN','Persönliche Erwartungen und Zusammenarbeit besprechen.',{marketing:true}),
 make('M08','Onboarding-Buddy aus dem Marketing auswählen','Head of Marketing',-1,'HUMAN','Verfügbarkeit und persönliche Eignung berücksichtigen.',{marketing:true}),
 make('M09','Brand Guidelines und Corporate Identity im Workspace bereitstellen','Head of Marketing',0,'HOTL','Link aus gepflegter Quelle beziehen; keinen Link erfinden.',{marketing:true,needs:['Freigegebener Link im Mitarbeiter-Workspace']}),
 make('M10','GDPR-for-Marketing-Schulung in DataGuard zuweisen','Head of Marketing',2,'HOTL','Standardisierte Schulung, Ausnahmen überwachen.',{marketing:true}),
 make('M11','Produkt- und Portfolio-Einführung mit Product Manager planen','Product Manager',3,'HUMAN','Fachlicher Austausch und individuelle Fragen.',{marketing:true}),
 make('M12','Alle Marketing-Zugänge vor dem ersten Tag bestätigen','Head of Marketing',-1,'HITL','Reale Freischaltungen prüfen; Anforderung genügt nicht.',{marketing:true}),
 make('M13','Check-in mit Head of Marketing nach zwei Wochen','Head of Marketing',10,'HUMAN','Persönliche Rückmeldung zur Einarbeitung.',{marketing:true})
];
export const modes={AUTO:'Vollautomatisch',HITL:'Mensch gibt frei',HOTL:'Mensch überwacht',HUMAN:'Menschliche Aufgabe'};
