import { TimeSelect } from '../TimeSelect'
import { ProfitLine } from './Productos'
import { useEffect, useState } from 'react'
import { api, mxn, toCents } from '../api'
import { hasGiro, type Me } from '../App'
import { Receta } from './Productos'

/**
 * Configurar el negocio: lo que cada giro necesita dar de alta para operar.
 * Solo aparecen las secciones del tipo de negocio (barbería: servicios y comisiones; restaurante: mesas; etc.).
 */

type Tab = { key: string; label: string; show: boolean; C: (p: { me: Me }) => JSX.Element }

const AGENDA = ['barberia', 'unas']
const SERVICE_GIROS = ['barberia', 'unas', 'papeleria', 'banos']

export function Configurar({ me }: { me: Me }) {
  const owner = me.user.role === 'owner'
  const tabs: Tab[] = [
    { key: 'servicios', label: hasGiro(me, 'barberia', 'unas', 'papeleria') ? 'Servicios' : 'Tarifas', show: hasGiro(me, ...SERVICE_GIROS), C: Servicios },
    { key: 'boletos', label: 'Tipos de boleto', show: hasGiro(me, 'turistico'), C: Boletos },
    { key: 'horarios', label: 'Horarios y aforo', show: owner && hasGiro(me, 'turistico'), C: Horarios },
    { key: 'copiadoras', label: 'Copiadoras', show: owner && hasGiro(me, 'papeleria'), C: Copiadoras },
    { key: 'mesas', label: 'Mesas', show: owner && (hasGiro(me, 'palapa', 'restaurante', 'taqueria') || (hasGiro(me, 'comedor') && !!me.settings?.tablesEnabled)), C: Mesas },
    { key: 'rentas', label: 'Rentas (sillas, camastros…)', show: owner && hasGiro(me, 'palapa'), C: Rentas },
    { key: 'limpieza', label: 'Tareas de limpieza', show: owner && hasGiro(me, 'banos'), C: Limpieza },
    { key: 'comisiones', label: 'Comisiones', show: owner && hasGiro(me, 'barberia', 'unas', 'perfumeria'), C: Comisiones },
    { key: 'categorias', label: 'Categorías de productos', show: true, C: Categorias },
  ].filter((t) => t.show)
  const [tab, setTab] = useState(tabs[0]!.key)
  const Cur = (tabs.find((t) => t.key === tab) ?? tabs[0]!).C
  return (
    <div className="page">
      <nav className="subtabs" aria-label="Qué configurar">{tabs.map((t) => <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>{t.label}</button>)}</nav>
      <Cur me={me} />
    </div>
  )
}

function useMsg() {
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const run = (fn: () => Promise<unknown>, ok = 'Guardado.') => async () => { try { await fn(); setMsg({ ok }) } catch (e) { setMsg({ err: (e as Error).message }) } }
  const view = <>{msg.err && <p className="error">{msg.err}</p>}{msg.ok && <p className="okmsg">{msg.ok}</p>}</>
  return { run, view, setMsg }
}

/** Lista con formulario al lado: tocar un renglón lo edita; "Quitar" lo desactiva sin borrar su historial. */
function Split({ list, form }: { list: JSX.Element; form: JSX.Element }) {
  return <div className="grid2 config">{list}{form}</div>
}

// ---------- Servicios / tarifas ----------

function Servicios({ me }: { me: Me }) {
  const agenda = hasGiro(me, ...AGENDA)
  const papel = hasGiro(me, 'papeleria')
  const unas = hasGiro(me, 'unas')
  const empty = { id: '', name: '', price: '', orig: -1, authCode: '', durationMin: agenda ? '30' : '', extraBlockMin: '', category: '', machineId: '', sheetsPerUnit: '1', cost: '' }
  const [list, setList] = useState<any[]>([])
  const [machines, setMachines] = useState<any[]>([])
  const [f, setF] = useState(empty)
  const [showOff, setShowOff] = useState(false)
  const { run, view } = useMsg()
  const load = async () => {
    setList((await api<any>('GET', '/services')).services.filter((s: any) => s.category !== 'boleto'))
    if (papel) setMachines((await api<any>('GET', '/machines')).machines.filter((m: any) => m.active))
  }
  useEffect(() => { void load() }, [])
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const save = run(async () => {
    const body = {
      name: f.name, price: toCents(f.price), category: f.category || null, cost: f.cost.trim() ? toCents(f.cost) : 0,
      ...(f.id && toCents(f.price) !== f.orig ? { authCode: f.authCode } : {}),
      durationMin: f.durationMin ? Number(f.durationMin) : null,
      ...(unas ? { attrs: { extraBlockMin: Number(f.extraBlockMin) || 0 } } : {}),
      ...(papel ? { machineId: f.machineId || null, sheetsPerUnit: f.machineId ? Number(f.sheetsPerUnit) || 1 : 0 } : {}),
    }
    if (f.id) await api('PATCH', `/services/${f.id}`, body)
    else await api('POST', '/services', body)
    setF(empty); await load()
  }, f.id ? 'Servicio actualizado.' : 'Servicio agregado.')
  const edit = (s: any) => setF({ id: s.id, name: s.name, price: String(s.price / 100), orig: s.price, authCode: '', durationMin: s.durationMin ? String(s.durationMin) : '', extraBlockMin: s.attrs?.extraBlockMin ? String(s.attrs.extraBlockMin) : '', category: s.category ?? '', machineId: s.machineId ?? '', sheetsPerUnit: String(s.sheetsPerUnit || 1), cost: s.cost ? String(s.cost / 100) : '' })
  const shown = list.filter((s) => showOff || s.active)
  const noun = agenda || papel ? 'servicio' : 'tarifa'
  return (
    <Split
      list={
        <section className="card">
          <div className="card-head"><h2>{agenda || papel ? 'Servicios' : 'Tarifas de entrada'}</h2><label className="check small"><input type="checkbox" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} />Ver quitados</label></div>
          {!agenda && !papel && <p className="muted small">Sanitario, regadera, casillero, toalla… Se combinan al cobrar la entrada.</p>}
          <div className="table-wrap"><table className="list"><thead><tr><th>Nombre</th>{agenda && <th className="num">Duración</th>}<th className="num">Precio</th><th /></tr></thead><tbody>
            {shown.map((s) => (
              <tr key={s.id} className={s.active ? 'clickable' : 'muted'} onClick={() => edit(s)}>
                <td>{s.name}{s.category && <><br /><small className="muted">{s.category}</small></>}</td>
                {agenda && <td className="num">{s.durationMin ? `${s.durationMin} min` : '—'}</td>}
                <td className="num">{mxn(s.price)}</td>
                <td className="num"><button className="mini" onClick={(e) => { e.stopPropagation(); void run(async () => { await api('PATCH', `/services/${s.id}`, { active: !s.active }); await load() }, s.active ? 'Quitado. Su historial se conserva.' : 'Activado de nuevo.')() }}>{s.active ? 'Quitar' : 'Activar'}</button></td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={4} className="muted">Todavía no hay {noun}s. Agrega el primero.</td></tr>}
          </tbody></table></div>
        </section>
      }
      form={
        <section className="card">
          <h2>{f.id ? `Editar ${noun}` : `Nuevo ${noun}`}</h2>
          <label>Nombre<input value={f.name} onChange={set('name')} placeholder={agenda ? (unas ? 'Ej. Manicure gel' : 'Ej. Corte de cabello') : papel ? 'Ej. Copia carta B/N' : 'Ej. Regadera'} /></label>
          <div className="row">
            <label>Precio<input inputMode="decimal" value={f.price} onChange={set('price')} placeholder="$0.00" /></label>
            {agenda && <label>Duración (min)<input inputMode="numeric" value={f.durationMin} onChange={set('durationMin')} /></label>}
          </div>
          <label>{agenda ? 'Costo por servicio (material: cera, gel, navajas…)' : papel ? 'Costo por unidad (hoja, tinta, luz)' : 'Costo por servicio (insumos)'} — opcional<input inputMode="decimal" value={f.cost} onChange={set('cost')} placeholder="$0.00" /></label>
          {f.cost.trim() !== '' && <ProfitLine price={toCents(f.price)} cost={toCents(f.cost)} margin={0} />}
          <p className="muted small" style={{ marginTop: -4 }}>Lo que gaste por receta (insumos del inventario) se suma solo. Las comisiones del personal se restan aparte.</p>
          {unas && <label>Tiempo de secado que bloquea la agenda (min)<input inputMode="numeric" value={f.extraBlockMin} onChange={set('extraBlockMin')} placeholder="0" /></label>}
          <label>{unas ? 'Técnica' : papel ? 'Tipo (copias, impresión, engargolado…)' : 'Categoría (opcional)'}<input value={f.category} onChange={set('category')} /></label>
          {f.id && toCents(f.price) !== f.orig && <label>Código de autorización (cambio de precio)<input type="password" value={f.authCode} onChange={set('authCode')} /></label>}
          {papel && (
            <div className="row">
              <label>Copiadora que usa<select value={f.machineId} onChange={set('machineId')}><option value="">Ninguna</option>{machines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
              {f.machineId && <label>Hojas por unidad<input inputMode="numeric" value={f.sheetsPerUnit} onChange={set('sheetsPerUnit')} /></label>}
            </div>
          )}
          {view}
          <p className="row">
            {f.id && <button onClick={() => setF(empty)}>Cancelar</button>}
            <button className="primary" disabled={f.name.trim().length < 1 || !(toCents(f.price) >= 0) || f.price.trim() === ''} onClick={save}>{f.id ? 'Guardar cambios' : 'Agregar'}</button>
          </p>
          {f.id && unas && <div className="danger-zone"><h3>Consumibles de esta técnica</h3><Receta ownerId={f.id} /></div>}
        </section>
      }
    />
  )
}

// ---------- Boletos (lugar turístico) ----------

function Boletos(_: { me: Me }) {
  const [list, setList] = useState<any[]>([])
  const [f, setF] = useState({ id: '', name: '', price: '', orig: -1, authCode: '' })
  const { run, view } = useMsg()
  const load = async () => setList((await api<any>('GET', '/services')).services.filter((s: any) => s.category === 'boleto'))
  useEffect(() => { void load() }, [])
  return (
    <Split
      list={
        <section className="card">
          <h2>Tipos de boleto</h2>
          <div className="table-wrap"><table className="list"><tbody>
            {list.map((s) => (
              <tr key={s.id} className={s.active ? 'clickable' : 'muted'} onClick={() => setF({ id: s.id, name: s.name, price: String(s.price / 100), orig: s.price, authCode: '' })}>
                <td>{s.name}</td><td className="num">{mxn(s.price)}</td>
                <td className="num"><button className="mini" onClick={(e) => { e.stopPropagation(); void run(async () => { await api('PATCH', `/services/${s.id}`, { active: !s.active }); await load() }, s.active ? 'Quitado.' : 'Activado.')() }}>{s.active ? 'Quitar' : 'Activar'}</button></td>
              </tr>
            ))}
            {list.length === 0 && <tr><td className="muted">Agrega adulto, niño, adulto mayor, estudiante…</td></tr>}
          </tbody></table></div>
        </section>
      }
      form={
        <section className="card">
          <h2>{f.id ? 'Editar boleto' : 'Nuevo tipo de boleto'}</h2>
          <label>Nombre<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ej. Adulto" /></label>
          <label>Precio<input inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} placeholder="$0.00" /></label>
          {f.id && toCents(f.price) !== f.orig && <label>Código de autorización (cambio de precio)<input type="password" value={f.authCode} onChange={(e) => setF({ ...f, authCode: e.target.value })} /></label>}
          {view}
          <p className="row">
            {f.id && <button onClick={() => setF({ id: '', name: '', price: '', orig: -1, authCode: '' })}>Cancelar</button>}
            <button className="primary" disabled={!f.name.trim() || f.price.trim() === ''} onClick={run(async () => {
              const body = { name: f.name, price: toCents(f.price), category: 'boleto', ...(f.id && toCents(f.price) !== f.orig ? { authCode: f.authCode } : {}) }
              if (f.id) await api('PATCH', `/services/${f.id}`, body); else await api('POST', '/services', body)
              setF({ id: '', name: '', price: '', orig: -1, authCode: '' }); await load()
            })}>{f.id ? 'Guardar cambios' : 'Agregar'}</button>
          </p>
        </section>
      }
    />
  )
}

// ---------- Horarios y aforo (lugar turístico) ----------

const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

function Horarios(_: { me: Me }) {
  const [rows, setRows] = useState<{ weekday: number; start: string; end: string; capacity: string }[]>([])
  const { run, view } = useMsg()
  useEffect(() => { api<any>('GET', '/tourism/slot-templates').then((r) => setRows(r.slots.map((s: any) => ({ ...s, capacity: String(s.capacity) })))).catch(() => {}) }, [])
  const upd = (i: number, k: string, v: string | number) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
  return (
    <section className="card">
      <h2>Horarios y aforo</h2>
      <p className="muted">Cada horario se repite cada semana. El aforo es cuántas personas caben; no se venden boletos de más.</p>
      <div className="table-wrap"><table className="list"><thead><tr><th>Día</th><th>Desde</th><th>Hasta</th><th>Aforo</th><th /></tr></thead><tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td><select value={r.weekday} onChange={(e) => upd(i, 'weekday', Number(e.target.value))}>{DAYS.map((d, k) => <option key={k} value={k}>{d}</option>)}</select></td>
            <td><TimeSelect aria-label="Desde" value={r.start} onChange={(v) => upd(i, 'start', v)} /></td>
            <td><TimeSelect aria-label="Hasta" value={r.end} onChange={(v) => upd(i, 'end', v)} /></td>
            <td><input inputMode="numeric" value={r.capacity} onChange={(e) => upd(i, 'capacity', e.target.value)} /></td>
            <td><button className="mini" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Quitar</button></td>
          </tr>
        ))}
      </tbody></table></div>
      <p className="row">
        <button onClick={() => setRows([...rows, { weekday: rows.at(-1)?.weekday ?? 1, start: '09:00', end: '11:00', capacity: '50' }])}>+ Agregar horario</button>
        <button onClick={() => { const base = rows.filter((r) => r.weekday === 1); if (base.length) setRows([...rows.filter((r) => r.weekday === 1 || r.weekday === 0 || r.weekday === 6), ...[2, 3, 4, 5].flatMap((d) => base.map((b) => ({ ...b, weekday: d })))]) }}>Copiar el lunes a martes–viernes</button>
      </p>
      {view}
      <p><button className="primary" onClick={run(() => api('PUT', '/tourism/slots', { slots: rows.map((r) => ({ weekday: r.weekday, start: r.start, end: r.end, capacity: Number(r.capacity) || 1 })) }), 'Horarios guardados.')}>Guardar horarios</button></p>
    </section>
  )
}

// ---------- Copiadoras (papelería) ----------

function Copiadoras(_: { me: Me }) {
  return <SimpleList title="Copiadoras" hint="Cada copiadora lleva su contador al abrir y cerrar el turno." placeholder="Ej. Copiadora Ricoh" path="/machines" listKey="machines" />
}

// ---------- Tareas de limpieza (baños) ----------

function Limpieza(_: { me: Me }) {
  return <SimpleList title="Tareas de limpieza" hint="Aparecen en Entradas para marcar quién las hizo y a qué hora." placeholder="Ej. Lavar regaderas" path="/cleaning/tasks" listKey="tasks" />
}

function SimpleList({ title, hint, placeholder, path, listKey }: { title: string; hint: string; placeholder: string; path: string; listKey: string }) {
  const [list, setList] = useState<any[]>([])
  const [name, setName] = useState('')
  const { run, view } = useMsg()
  const load = async () => setList((await api<any>('GET', path))[listKey])
  useEffect(() => { void load() }, [])
  return (
    <section className="card" style={{ maxWidth: 720 }}>
      <h2>{title}</h2>
      <p className="muted">{hint}</p>
      <div className="table-wrap"><table className="list"><tbody>
        {list.map((m) => (
          <tr key={m.id} className={m.active ? '' : 'muted'}>
            <td>{m.name}</td>
            <td className="num">
              <button className="mini" onClick={() => { const n = prompt('Nuevo nombre:', m.name); if (n) void run(async () => { await api('PATCH', `${path}/${m.id}`, { name: n }); await load() })() }}>Renombrar</button>{' '}
              <button className="mini" onClick={run(async () => { await api('PATCH', `${path}/${m.id}`, { active: !m.active }); await load() }, m.active ? 'Quitado.' : 'Activado.')}>{m.active ? 'Quitar' : 'Activar'}</button>
            </td>
          </tr>
        ))}
        {list.length === 0 && <tr><td className="muted">Todavía no hay ninguno.</td></tr>}
      </tbody></table></div>
      <div className="row" style={{ marginTop: 12 }}><input aria-label="Nombre" value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder} /><button className="primary" style={{ flex: '0 0 auto' }} disabled={name.trim().length < 2} onClick={run(async () => { await api('POST', path, { name }); setName(''); await load() }, 'Agregado.')}>Agregar</button></div>
      {view}
    </section>
  )
}

// ---------- Rentas (palapa) ----------

function Rentas(_: { me: Me }) {
  const empty = { id: '', name: '', quantity: '', price: '' }
  const [list, setList] = useState<any[]>([])
  const [f, setF] = useState(empty)
  const { run, view } = useMsg()
  const load = async () => setList((await api<any>('GET', '/rental-assets')).assets)
  useEffect(() => { void load() }, [])
  return (
    <Split
      list={
        <section className="card">
          <h2>Lo que se renta</h2>
          <div className="table-wrap"><table className="list"><thead><tr><th>Activo</th><th className="num">Tienes</th><th className="num">Fuera</th><th className="num">Precio</th></tr></thead><tbody>
            {list.map((a) => <tr key={a.id} className="clickable" onClick={() => setF({ id: a.id, name: a.name, quantity: String(a.quantity), price: String(a.price / 100) })}><td>{a.name}</td><td className="num">{a.quantity}</td><td className="num">{a.out}</td><td className="num">{mxn(a.price)}</td></tr>)}
            {list.length === 0 && <tr><td colSpan={4} className="muted">Ej. sillas, mesas plegables, camastros, sombrillas.</td></tr>}
          </tbody></table></div>
        </section>
      }
      form={
        <section className="card">
          <h2>{f.id ? 'Editar' : 'Agregar activo'}</h2>
          <label>Nombre<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ej. Camastro" /></label>
          <div className="row">
            <label>Cuántos tienes<input inputMode="numeric" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></label>
            <label>Precio de renta<input inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} placeholder="$0.00" /></label>
          </div>
          {view}
          <p className="row">
            {f.id && <button onClick={run(async () => { await api('PATCH', `/rental-assets/${f.id}`, { active: false }); setF(empty); await load() }, 'Quitado.')}>Quitar</button>}
            {f.id && <button onClick={() => setF(empty)}>Cancelar</button>}
            <button className="primary" disabled={f.name.trim().length < 2 || f.quantity.trim() === '' || f.price.trim() === ''} onClick={run(async () => {
              const body = { name: f.name, quantity: Number(f.quantity) || 0, price: toCents(f.price) }
              if (f.id) await api('PATCH', `/rental-assets/${f.id}`, body); else await api('POST', '/rental-assets', body)
              setF(empty); await load()
            }, f.id ? 'Guardado.' : 'Agregado.')}>{f.id ? 'Guardar cambios' : 'Agregar'}</button>
          </p>
        </section>
      }
    />
  )
}

// ---------- Mesas ----------

const AREAS: Record<string, string> = { salon: 'Salón', terraza: 'Terraza', barra: 'Barra', privada: 'Área privada' }

function Mesas(_: { me: Me }) {
  const empty = { id: '', name: '', area: 'salon', seats: '4', minConsumption: '' }
  const [list, setList] = useState<any[]>([])
  const [f, setF] = useState(empty)
  const { run, view } = useMsg()
  const load = async () => setList((await api<any>('GET', '/tables')).tables)
  useEffect(() => { void load() }, [])
  const areas = [...new Set(list.map((t) => t.area))]
  return (
    <Split
      list={
        <section className="card">
          <h2>Mesas</h2>
          {areas.map((a) => (
            <div key={a}>
              <h3 className="muted" style={{ marginTop: 10 }}>{AREAS[a] ?? a}</h3>
              <div className="chips">{list.filter((t) => t.area === a).map((t) => (
                <button key={t.id} className="chip" onClick={() => setF({ id: t.id, name: t.name, area: t.area, seats: String(t.seats), minConsumption: t.minConsumption ? String(t.minConsumption / 100) : '' })}>Mesa {t.name} · {t.seats} lugares</button>
              ))}</div>
            </div>
          ))}
          {list.length === 0 && <p className="muted">Agrega tus mesas para verlas en el mapa.</p>}
        </section>
      }
      form={
        <section className="card">
          <h2>{f.id ? `Editar mesa ${f.name}` : 'Nueva mesa'}</h2>
          <div className="row">
            <label>Número o nombre<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ej. 7" /></label>
            <label>Lugares<input inputMode="numeric" value={f.seats} onChange={(e) => setF({ ...f, seats: e.target.value })} /></label>
          </div>
          <label>Área<select value={AREAS[f.area] ? f.area : 'otra'} onChange={(e) => setF({ ...f, area: e.target.value === 'otra' ? '' : e.target.value })}>{Object.entries(AREAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}<option value="otra">Otra…</option></select></label>
          {!AREAS[f.area] && <label>Nombre del área<input value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} placeholder="Ej. Jardín" /></label>}
          <label>Consumo mínimo (opcional)<input inputMode="decimal" value={f.minConsumption} onChange={(e) => setF({ ...f, minConsumption: e.target.value })} placeholder="Sin mínimo" /></label>
          {view}
          <p className="row">
            {f.id && <button onClick={run(async () => { await api('PATCH', `/tables/${f.id}`, { active: false }); setF(empty); await load() }, 'Mesa quitada.')}>Quitar mesa</button>}
            {f.id && <button onClick={() => setF(empty)}>Cancelar</button>}
            <button className="primary" disabled={!f.name.trim() || f.area.trim().length < 2} onClick={run(async () => {
              const body = { name: f.name, area: f.area, seats: Number(f.seats) || 1, minConsumption: f.minConsumption ? toCents(f.minConsumption) : null }
              if (f.id) await api('PATCH', `/tables/${f.id}`, body); else await api('POST', '/tables', body)
              setF({ ...empty, area: f.area }); await load()
            }, f.id ? 'Mesa actualizada.' : 'Mesa agregada.')}>{f.id ? 'Guardar cambios' : 'Agregar mesa'}</button>
          </p>
        </section>
      }
    />
  )
}

// ---------- Comisiones ----------

const TARGET: Record<string, string> = { all: 'Todo lo que venda', service: 'Un servicio', product: 'Un producto', category: 'Una categoría', brand: 'Una marca' }

function Comisiones({ me }: { me: Me }) {
  const [rules, setRules] = useState<{ staffId: string; targetType: string; targetId: string; rate: string }[]>([])
  const [staff, setStaff] = useState<any[]>([])
  const [opts, setOpts] = useState<{ service: any[]; product: any[]; category: any[] }>({ service: [], product: [], category: [] })
  const { run, view } = useMsg()
  useEffect(() => {
    void (async () => {
      const [r, u, s, p, c] = await Promise.all([api<any>('GET', '/commission-rules'), api<any>('GET', '/users'), api<any>('GET', '/services'), api<any>('GET', '/products'), api<any>('GET', '/categories')])
      setRules(r.rules.map((x: any) => ({ staffId: x.staffId ?? '', targetType: x.targetType, targetId: x.targetId ?? '', rate: String(x.rateBp / 100) })))
      setStaff(u.users.filter((x: any) => x.role === 'staff' && x.active))
      setOpts({ service: s.services.filter((x: any) => x.active), product: p.products.filter((x: any) => x.active !== false), category: c.categories })
    })().catch(() => {})
  }, [])
  const upd = (i: number, k: string, v: string) => setRules(rules.map((r, j) => (j === i ? { ...r, [k]: v, ...(k === 'targetType' ? { targetId: '' } : {}) } : r)))
  const choices = (t: string): { id: string; name: string }[] => (t === 'brand' ? [...new Set(opts.product.map((p: any) => p.attrs?.brand).filter(Boolean))].map((b) => ({ id: b as string, name: b as string })) : (opts as any)[t] ?? [])
  return (
    <section className="card">
      <h2>Comisiones</h2>
      <p className="muted">Sin reglas no hay comisión. La regla más específica gana (por persona y por servicio antes que «todo»). Los cambios aplican a ventas nuevas.</p>
      <div className="table-wrap"><table className="list"><thead><tr><th>Quién</th><th>Sobre qué</th><th>Cuál</th><th className="num">%</th><th /></tr></thead><tbody>
        {rules.map((r, i) => (
          <tr key={i}>
            <td><select value={r.staffId} onChange={(e) => upd(i, 'staffId', e.target.value)}><option value="">Todos</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></td>
            <td><select value={r.targetType} onChange={(e) => upd(i, 'targetType', e.target.value)}>{Object.entries(TARGET).filter(([k]) => k !== 'brand' || hasGiro(me, 'perfumeria')).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
            <td>{r.targetType === 'all' ? <span className="muted">—</span> : <select value={r.targetId} onChange={(e) => upd(i, 'targetId', e.target.value)}><option value="">Elige…</option>{choices(r.targetType).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>}</td>
            <td><input inputMode="decimal" value={r.rate} onChange={(e) => upd(i, 'rate', e.target.value)} style={{ width: '5em' }} /></td>
            <td><button className="mini" onClick={() => setRules(rules.filter((_, j) => j !== i))}>Quitar</button></td>
          </tr>
        ))}
        {rules.length === 0 && <tr><td colSpan={5} className="muted">Sin reglas todavía.</td></tr>}
      </tbody></table></div>
      <p><button onClick={() => setRules([...rules, { staffId: '', targetType: 'all', targetId: '', rate: '30' }])}>+ Agregar regla</button></p>
      {view}
      <p><button className="primary" onClick={run(() => api('PUT', '/commission-rules', { rules: rules.map((r) => ({ staffId: r.staffId || null, targetType: r.targetType, targetId: r.targetType === 'all' ? null : r.targetId || null, rateBp: Math.round(Number(r.rate) * 100) || 0 })) }), 'Comisiones guardadas.')}>Guardar comisiones</button></p>
    </section>
  )
}

// ---------- Categorías ----------

function Categorias(_: { me: Me }) {
  const [list, setList] = useState<any[]>([])
  const [f, setF] = useState({ id: '', name: '', margin: '' })
  const { run, view } = useMsg()
  const load = async () => setList((await api<any>('GET', '/categories')).categories)
  useEffect(() => { void load() }, [])
  return (
    <Split
      list={
        <section className="card">
          <h2>Categorías</h2>
          <p className="muted small">Agrupan productos. Con margen, el sistema sugiere el precio de venta según el costo.</p>
          <div className="table-wrap"><table className="list"><tbody>
            {list.map((c) => <tr key={c.id} className="clickable" onClick={() => setF({ id: c.id, name: c.name, margin: c.marginBp != null ? String(c.marginBp / 100) : '' })}><td>{c.name}</td><td className="num muted">{c.marginBp != null ? `margen ${c.marginBp / 100} %` : 'sin margen'}</td></tr>)}
            {list.length === 0 && <tr><td className="muted">Ej. Bebidas, Lácteos, Limpieza.</td></tr>}
          </tbody></table></div>
        </section>
      }
      form={
        <section className="card">
          <h2>{f.id ? 'Editar categoría' : 'Nueva categoría'}</h2>
          <label>Nombre<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label>Margen sugerido % (opcional)<input inputMode="decimal" value={f.margin} onChange={(e) => setF({ ...f, margin: e.target.value })} placeholder="Ej. 30" /></label>
          {view}
          <p className="row">
            {f.id && <button onClick={() => setF({ id: '', name: '', margin: '' })}>Cancelar</button>}
            <button className="primary" disabled={f.name.trim().length < 2} onClick={run(async () => {
              const body = { name: f.name, marginBp: f.margin.trim() ? Math.round(Number(f.margin) * 100) : null }
              if (f.id) await api('PATCH', `/categories/${f.id}`, body); else await api('POST', '/categories', body)
              setF({ id: '', name: '', margin: '' }); await load()
            })}>{f.id ? 'Guardar cambios' : 'Agregar'}</button>
          </p>
        </section>
      }
    />
  )
}
