import Database from 'better-sqlite3'

export type Db = Database.Database

const MIGRATIONS: string[] = [
  `
  CREATE TABLE businesses (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    phone TEXT,
    logo_url TEXT,
    status TEXT NOT NULL DEFAULT 'prueba' CHECK (status IN ('prueba','activo','vencido','suspendido')),
    trial_days INTEGER,
    force_password_change INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE branches (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    branch_id TEXT REFERENCES branches(id),
    role TEXT NOT NULL CHECK (role IN ('owner','staff')),
    name TEXT NOT NULL,
    username TEXT,
    phone TEXT,
    phone_verified INTEGER NOT NULL DEFAULT 0,
    password_hash TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    permissions TEXT NOT NULL DEFAULT '[]',
    auth_code_hash TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    auth_failed_attempts INTEGER NOT NULL DEFAULT 0,
    auth_locked_until TEXT,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX users_username ON users(business_id, username) WHERE username IS NOT NULL;
  CREATE UNIQUE INDEX users_owner_phone ON users(phone) WHERE role = 'owner';
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    token_hash TEXT NOT NULL UNIQUE,
    device_id TEXT,
    device_name TEXT,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT
  );
  CREATE TABLE verification_codes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    purpose TEXT NOT NULL CHECK (purpose IN ('registro','login')),
    code_hash TEXT NOT NULL,
    device_id TEXT,
    device_name TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE audit_log (
    id TEXT PRIMARY KEY,
    business_id TEXT,
    user_id TEXT,
    action TEXT NOT NULL,
    entity TEXT,
    entity_id TEXT,
    old_value TEXT,
    new_value TEXT,
    authorized_by TEXT,
    reason TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX audit_business ON audit_log(business_id, created_at);
  -- Bitácora inmutable: nada se edita ni se borra.
  CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'La bitácora no se puede modificar'); END;
  CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'La bitácora no se puede borrar'); END;

  CREATE TABLE shifts (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    cashier_id TEXT NOT NULL REFERENCES users(id),
    opening_float INTEGER NOT NULL CHECK (opening_float >= 0),
    opened_at TEXT NOT NULL,
    opened_date TEXT NOT NULL,
    closed_at TEXT,
    closed_by TEXT REFERENCES users(id),
    expected_cash INTEGER,
    counted_cash INTEGER,
    difference INTEGER,
    difference_reason TEXT,
    status TEXT NOT NULL DEFAULT 'abierto' CHECK (status IN ('abierto','cerrado'))
  );
  CREATE UNIQUE INDEX shifts_one_open ON shifts(cashier_id) WHERE status = 'abierto';
  CREATE TABLE cash_movements (
    id TEXT PRIMARY KEY,
    shift_id TEXT NOT NULL REFERENCES shifts(id),
    type TEXT NOT NULL CHECK (type IN ('retiro','deposito')),
    amount INTEGER NOT NULL CHECK (amount > 0),
    reason TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL
  );
  CREATE TABLE day_closes (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    date TEXT NOT NULL,
    summary TEXT NOT NULL,
    closed_by TEXT NOT NULL REFERENCES users(id),
    closed_at TEXT NOT NULL,
    UNIQUE (branch_id, date)
  );
  CREATE TABLE sale_counters (branch_id TEXT PRIMARY KEY REFERENCES branches(id), last INTEGER NOT NULL);
  CREATE TABLE sales (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    shift_id TEXT NOT NULL REFERENCES shifts(id),
    folio INTEGER NOT NULL,
    cashier_id TEXT NOT NULL REFERENCES users(id),
    subtotal INTEGER NOT NULL,
    discount INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL,
    payment_method TEXT NOT NULL CHECK (payment_method IN ('efectivo','transferencia','tarjeta')),
    status TEXT NOT NULL DEFAULT 'completada' CHECK (status IN ('completada','cancelada')),
    discount_authorized_by TEXT REFERENCES users(id),
    cancelled_by TEXT REFERENCES users(id),
    cancel_authorized_by TEXT REFERENCES users(id),
    cancel_reason TEXT,
    cancelled_at TEXT,
    created_at TEXT NOT NULL,
    received_at TEXT NOT NULL,
    UNIQUE (branch_id, folio)
  );
  CREATE INDEX sales_shift ON sales(shift_id);
  CREATE TABLE sale_items (
    id TEXT PRIMARY KEY,
    sale_id TEXT NOT NULL REFERENCES sales(id),
    description TEXT NOT NULL,
    quantity REAL NOT NULL CHECK (quantity > 0),
    unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
    total INTEGER NOT NULL
  );
  -- Nada se borra: ventas y partidas son permanentes.
  CREATE TRIGGER sales_no_delete BEFORE DELETE ON sales BEGIN SELECT RAISE(ABORT, 'Las ventas no se pueden borrar'); END;
  CREATE TRIGGER sale_items_no_delete BEFORE DELETE ON sale_items BEGIN SELECT RAISE(ABORT, 'Las ventas no se pueden borrar'); END;
  CREATE TRIGGER shifts_no_delete BEFORE DELETE ON shifts BEGIN SELECT RAISE(ABORT, 'Los turnos no se pueden borrar'); END;
  CREATE TRIGGER cash_movements_no_delete BEFORE DELETE ON cash_movements BEGIN SELECT RAISE(ABORT, 'Los movimientos no se pueden borrar'); END;
  `,
  `
  CREATE TABLE idempotency (
    user_id TEXT NOT NULL,
    key TEXT NOT NULL,
    status INTEGER NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, key)
  );
  -- Cambios de datos compartidos entre equipos (productos, clientes, etc.). Nunca se borran.
  CREATE TABLE sync_changes (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    op_id TEXT NOT NULL UNIQUE,
    business_id TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    data TEXT NOT NULL,
    client_updated_at TEXT NOT NULL,
    device_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    applied INTEGER NOT NULL,
    received_at TEXT NOT NULL
  );
  CREATE INDEX sync_changes_pull ON sync_changes(business_id, seq);
  CREATE TABLE sync_state (
    business_id TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    data TEXT NOT NULL,
    client_updated_at TEXT NOT NULL,
    device_id TEXT NOT NULL,
    PRIMARY KEY (business_id, entity, entity_id)
  );
  CREATE TABLE sync_conflicts (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    winner TEXT NOT NULL,
    loser TEXT NOT NULL,
    winner_device TEXT NOT NULL,
    loser_device TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','revisado')),
    created_at TEXT NOT NULL,
    reviewed_by TEXT,
    reviewed_at TEXT
  );
  CREATE TRIGGER sync_changes_no_delete BEFORE DELETE ON sync_changes BEGIN SELECT RAISE(ABORT, 'Los cambios no se pueden borrar'); END;
  CREATE TRIGGER sync_conflicts_no_delete BEFORE DELETE ON sync_conflicts BEGIN SELECT RAISE(ABORT, 'Los conflictos no se pueden borrar'); END;
  `,
  `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  INSERT INTO settings (key, value) VALUES ('default_trial_days', '14'), ('suspend_after_days', '30');
  ALTER TABLE businesses ADD COLUMN trial_ends_at TEXT;
  ALTER TABLE businesses ADD COLUMN paid_until TEXT;
  ALTER TABLE businesses ADD COLUMN overdue_since TEXT;
  ALTER TABLE businesses ADD COLUMN suspended_reason TEXT;
  ALTER TABLE businesses ADD COLUMN plan TEXT NOT NULL DEFAULT 'inicial';
  ALTER TABLE businesses ADD COLUMN extra_branches INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE businesses ADD COLUMN extra_user_packs INTEGER NOT NULL DEFAULT 0;
  -- Cambio de plan que se aplica al siguiente periodo de cobro.
  ALTER TABLE businesses ADD COLUMN pending_plan TEXT;
  ALTER TABLE branches ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
  UPDATE businesses SET trial_days = 14 WHERE trial_days IS NULL;
  UPDATE businesses SET trial_ends_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+' || trial_days || ' days') WHERE trial_ends_at IS NULL;

  CREATE TABLE admins (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE admin_sessions (
    id TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL REFERENCES admins(id),
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT
  );
  CREATE TABLE payments (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    months INTEGER NOT NULL CHECK (months > 0),
    amount INTEGER NOT NULL CHECK (amount >= 0),
    note TEXT,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    recorded_by TEXT NOT NULL REFERENCES admins(id),
    created_at TEXT NOT NULL
  );
  CREATE TRIGGER payments_no_delete BEFORE DELETE ON payments BEGIN SELECT RAISE(ABORT, 'Los pagos no se pueden borrar'); END;

  -- Buzón: soporte y solicitudes de cambio. Privado por negocio.
  CREATE TABLE tickets (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    type TEXT NOT NULL CHECK (type IN ('soporte','cambio')),
    subject TEXT NOT NULL,
    module TEXT,
    status TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    unread_by_client INTEGER NOT NULL DEFAULT 0,
    unread_by_support INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX tickets_business ON tickets(business_id, updated_at);
  CREATE TABLE ticket_messages (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL REFERENCES tickets(id),
    author_type TEXT NOT NULL CHECK (author_type IN ('cliente','soporte')),
    author_id TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TRIGGER tickets_no_delete BEFORE DELETE ON tickets BEGIN SELECT RAISE(ABORT, 'El buzón no se puede borrar'); END;
  CREATE TRIGGER ticket_messages_no_delete BEFORE DELETE ON ticket_messages BEGIN SELECT RAISE(ABORT, 'El buzón no se puede borrar'); END;
  `,
  `
  -- Módulos que se activan solo si el negocio los necesita.
  ALTER TABLE businesses ADD COLUMN modules TEXT NOT NULL DEFAULT '[]';

  CREATE TABLE customers (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    name TEXT NOT NULL,
    phone TEXT,
    notes TEXT,
    -- Identificador único, aleatorio y no consecutivo para QR / código de barras.
    code TEXT NOT NULL UNIQUE,
    loyalty_enrolled INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE INDEX customers_business ON customers(business_id, name);

  CREATE TABLE visits (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    visit_date TEXT NOT NULL,
    at TEXT NOT NULL,
    scanned_by TEXT NOT NULL REFERENCES users(id)
  );
  CREATE UNIQUE INDEX visits_one_per_day ON visits(customer_id, visit_date);

  CREATE TABLE membership_plans (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    name TEXT NOT NULL,
    uses_per_period INTEGER NOT NULL CHECK (uses_per_period > 0),
    period TEXT NOT NULL CHECK (period IN ('dia','semana','mes')),
    price INTEGER NOT NULL CHECK (price >= 0),
    applies_to TEXT NOT NULL DEFAULT '[]',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE customer_memberships (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    plan_id TEXT NOT NULL REFERENCES membership_plans(id),
    -- Copia del plan al venderse: editar el plan no altera membresías ya vendidas.
    plan_snapshot TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    price_paid INTEGER NOT NULL,
    sale_id TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE membership_uses (
    id TEXT PRIMARY KEY,
    membership_id TEXT NOT NULL REFERENCES customer_memberships(id),
    use_date TEXT NOT NULL,
    period_start TEXT NOT NULL,
    at TEXT NOT NULL,
    scanned_by TEXT NOT NULL
  );
  CREATE UNIQUE INDEX membership_one_use_per_visit ON membership_uses(membership_id, use_date);

  CREATE TABLE promotions (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('porcentaje','monto')),
    value INTEGER NOT NULL CHECK (value > 0),
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    -- {"all":true} o {"refs":[...],"categories":[...]}
    applies_to TEXT NOT NULL,
    combinable INTEGER NOT NULL DEFAULT 0,
    min_quantity INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE sale_promotions (
    sale_id TEXT NOT NULL REFERENCES sales(id),
    promotion_id TEXT NOT NULL REFERENCES promotions(id),
    amount INTEGER NOT NULL,
    PRIMARY KEY (sale_id, promotion_id)
  );
  ALTER TABLE sales ADD COLUMN promo_discount INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE sales ADD COLUMN customer_id TEXT REFERENCES customers(id);
  ALTER TABLE sale_items ADD COLUMN ref TEXT;
  ALTER TABLE sale_items ADD COLUMN category TEXT;

  CREATE TABLE loyalty_program (
    business_id TEXT PRIMARY KEY REFERENCES businesses(id),
    unit TEXT NOT NULL CHECK (unit IN ('puntos','sellos')),
    earn_by TEXT NOT NULL CHECK (earn_by IN ('monto','visita')),
    -- monto: cada earn_amount centavos dan earn_points; visita: cada visita da earn_points.
    earn_amount INTEGER,
    earn_points INTEGER NOT NULL CHECK (earn_points > 0),
    scope TEXT NOT NULL CHECK (scope IN ('todos','por_persona')),
    updated_at TEXT NOT NULL
  );
  CREATE TABLE loyalty_rewards (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    name TEXT NOT NULL,
    cost INTEGER NOT NULL CHECK (cost > 0),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE loyalty_ledger (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    delta INTEGER NOT NULL,
    reason TEXT NOT NULL,
    sale_id TEXT,
    reward_id TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX loyalty_ledger_customer ON loyalty_ledger(customer_id);

  CREATE TABLE staff_attendance (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id),
    type TEXT NOT NULL CHECK (type IN ('entrada','salida')),
    at TEXT NOT NULL
  );
  CREATE TRIGGER visits_no_delete BEFORE DELETE ON visits BEGIN SELECT RAISE(ABORT, 'No se puede borrar'); END;
  CREATE TRIGGER membership_uses_no_delete BEFORE DELETE ON membership_uses BEGIN SELECT RAISE(ABORT, 'No se puede borrar'); END;
  CREATE TRIGGER loyalty_ledger_no_delete BEFORE DELETE ON loyalty_ledger BEGIN SELECT RAISE(ABORT, 'No se puede borrar'); END;
  CREATE TRIGGER loyalty_ledger_no_update BEFORE UPDATE ON loyalty_ledger BEGIN SELECT RAISE(ABORT, 'No se puede modificar'); END;
  CREATE TRIGGER staff_attendance_no_delete BEFORE DELETE ON staff_attendance BEGIN SELECT RAISE(ABORT, 'No se puede borrar'); END;
  `,
]

export function openDb(path = ':memory:'): Db {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY)')
  const done = new Set((db.prepare('SELECT version FROM _migrations').all() as { version: number }[]).map((r) => r.version))
  MIGRATIONS.forEach((sql, i) => {
    if (done.has(i + 1)) return
    db.transaction(() => {
      db.exec(sql)
      db.prepare('INSERT INTO _migrations (version) VALUES (?)').run(i + 1)
    })()
  })
  return db
}
