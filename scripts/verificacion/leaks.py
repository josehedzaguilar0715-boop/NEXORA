import json,re,sys
d=json.load(open(sys.argv[1]))
# Palabras que pertenecen a ciertos giros (si aparecen en otro, es una fuga).
T={
 'barbero':{'barberia'},'barbería':{'barberia'},'técnica':{'unas'},'uñas':{'unas'},'cita':{'barberia','unas'},'agenda':{'barberia','unas'},
 'mesa':{'palapa','restaurante','comedor','taqueria'},'mesero':{'palapa','restaurante','comedor','taqueria'},'comanda':{'palapa','restaurante','comedor','taqueria'},
 'cocina':{'palapa','restaurante','comedor','taqueria'},'platillo':{'palapa','restaurante','comedor','taqueria'},'receta':{'palapa','restaurante','comedor','taqueria','papeleria','barberia','unas'},
 'guisado':{'taqueria'},'trompo':{'taqueria'},'menú':{'comedor','taqueria','restaurante','palapa'},'propina':{'palapa','restaurante','comedor','taqueria','barberia','unas'},
 'fiado':{'abarrotes','ferreteria','papeleria','verduleria','comedor','taqueria'},'apartado':{'abarrotes'},'granel':{'abarrotes','verduleria','ferreteria'},
 'cotización':{'ferreteria'},'decant':{'perfumeria'},'fragancia':{'perfumeria'},'tester':{'perfumeria'},'copias':{'papeleria'},'encargo':{'papeleria'},
 'regadera':{'banos'},'taquilla':{'turistico'},'boleto':{'turistico'},'sombrilla':{'palapa'},'manojo':{'verduleria'},'precio del día':{'verduleria','palapa','taqueria'},
 'caducidad':{'abarrotes','verduleria','perfumeria','papeleria','ferreteria','comedor','restaurante','taqueria','palapa'},
 'paciente':set(),'alumno':set(),'huésped':set(),
}
for g,v in d.items():
  hits={}
  for scr,txt in list(v['screens'].items())+[('MENÚ',v['nav'])]:
    low=txt.lower()
    for w,ok in T.items():
      if g in ok: continue
      for m in re.finditer(r'\b'+re.escape(w)+r'(s|es)?\b',low):
        a=max(0,m.start()-50); ctx=txt[a:m.end()+40].replace('\n',' ⏎ ')
        hits.setdefault((w,scr),ctx)
  if hits:
    print(f'== {g} ({len(hits)})')
    for (w,s),c in sorted(hits.items()): print(f'  [{s}] {w}: …{c}…')
