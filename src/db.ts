/**
 * Acceso a la base. Dos implementaciones con la misma forma (síncrona):
 * better-sqlite3 en local y pruebas (`db-node.ts`) y SQLite de Durable Objects en Cloudflare (`db-do.ts`).
 */
export interface Statement {
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
  run(...params: unknown[]): { changes: number }
}
export interface Db {
  prepare(sql: string): Statement
  exec(sql: string): void
  transaction<F extends (...args: any[]) => any>(fn: F): F
  pragma(source: string, options?: { simple?: boolean }): unknown
}

type Migration = string | { sql: string; fkOff: true }

const MIGRATIONS: Migration[] = [
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
  {
    fkOff: true,
    sql: `
  -- Ventas: se agrega "fiado" como forma de pago y el efectivo recibido (para dar cambio).
  CREATE TABLE sales_new (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    shift_id TEXT NOT NULL REFERENCES shifts(id),
    folio INTEGER NOT NULL,
    cashier_id TEXT NOT NULL REFERENCES users(id),
    subtotal INTEGER NOT NULL,
    discount INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL,
    payment_method TEXT NOT NULL CHECK (payment_method IN ('efectivo','transferencia','tarjeta','fiado')),
    status TEXT NOT NULL DEFAULT 'completada' CHECK (status IN ('completada','cancelada')),
    discount_authorized_by TEXT REFERENCES users(id),
    cancelled_by TEXT REFERENCES users(id),
    cancel_authorized_by TEXT REFERENCES users(id),
    cancel_reason TEXT,
    cancelled_at TEXT,
    created_at TEXT NOT NULL,
    received_at TEXT NOT NULL,
    promo_discount INTEGER NOT NULL DEFAULT 0,
    customer_id TEXT REFERENCES customers(id),
    cash_received INTEGER,
    price_authorized_by TEXT REFERENCES users(id),
    credit_authorized_by TEXT REFERENCES users(id),
    UNIQUE (branch_id, folio)
  );
  INSERT INTO sales_new (id, business_id, branch_id, shift_id, folio, cashier_id, subtotal, discount, total, payment_method, status, discount_authorized_by, cancelled_by, cancel_authorized_by, cancel_reason, cancelled_at, created_at, received_at, promo_discount, customer_id)
    SELECT id, business_id, branch_id, shift_id, folio, cashier_id, subtotal, discount, total, payment_method, status, discount_authorized_by, cancelled_by, cancel_authorized_by, cancel_reason, cancelled_at, created_at, received_at, promo_discount, customer_id FROM sales;
  DROP TABLE sales;
  ALTER TABLE sales_new RENAME TO sales;
  CREATE INDEX sales_shift ON sales(shift_id);
  CREATE INDEX sales_customer ON sales(customer_id);
  CREATE TRIGGER sales_no_delete BEFORE DELETE ON sales BEGIN SELECT RAISE(ABORT, 'Las ventas no se pueden borrar'); END;

  ALTER TABLE sale_items ADD COLUMN product_id TEXT;
  ALTER TABLE sale_items ADD COLUMN presentation_id TEXT;
  ALTER TABLE sale_items ADD COLUMN qty_milli INTEGER;
  ALTER TABLE sale_items ADD COLUMN cost INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE businesses ADD COLUMN reserve_days INTEGER;
  ALTER TABLE customers ADD COLUMN credit_limit INTEGER NOT NULL DEFAULT 0;

  -- Cajas por sucursal; cada cajero puede tener una caja asignada.
  CREATE TABLE registers (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  ALTER TABLE users ADD COLUMN register_id TEXT REFERENCES registers(id);
  ALTER TABLE shifts ADD COLUMN register_id TEXT REFERENCES registers(id);
  CREATE UNIQUE INDEX shifts_one_open_register ON shifts(register_id) WHERE status = 'abierto' AND register_id IS NOT NULL;

  CREATE TABLE categories (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    name TEXT NOT NULL,
    -- Margen sugerido en puntos base (3000 = 30 %). Sin margen no hay sugerencia.
    margin_bp INTEGER,
    created_at TEXT NOT NULL,
    UNIQUE (business_id, name)
  );
  CREATE TABLE products (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    name TEXT NOT NULL,
    category_id TEXT REFERENCES categories(id),
    barcode TEXT,
    -- pieza: cantidades enteras; granel: por kilo (u otra unidad base).
    unit TEXT NOT NULL CHECK (unit IN ('pieza','kg','metro','litro')),
    price INTEGER NOT NULL CHECK (price >= 0),
    margin_bp INTEGER,
    min_stock_milli INTEGER NOT NULL DEFAULT 0,
    track_expiry INTEGER NOT NULL DEFAULT 0,
    last_cost REAL NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    updated_device TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX products_barcode ON products(business_id, barcode) WHERE barcode IS NOT NULL;
  CREATE TABLE presentations (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES products(id),
    name TEXT NOT NULL,
    factor_milli INTEGER NOT NULL CHECK (factor_milli > 0),
    price INTEGER NOT NULL CHECK (price >= 0),
    barcode TEXT,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE suppliers (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    name TEXT NOT NULL,
    phone TEXT,
    notes TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE purchases (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    supplier_id TEXT REFERENCES suppliers(id),
    ticket_ref TEXT,
    items_total INTEGER NOT NULL,
    freight_total INTEGER NOT NULL,
    freight_detail TEXT NOT NULL,
    payment TEXT NOT NULL CHECK (payment IN ('contado','credito')),
    due_date TEXT,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL
  );
  CREATE TABLE lots (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL,
    branch_id TEXT NOT NULL REFERENCES branches(id),
    product_id TEXT NOT NULL REFERENCES products(id),
    purchase_id TEXT REFERENCES purchases(id),
    source_lot_id TEXT REFERENCES lots(id),
    qty_initial_milli INTEGER NOT NULL,
    qty_remaining_milli INTEGER NOT NULL CHECK (qty_remaining_milli >= 0),
    -- Costo real por unidad (incluye su parte de fletes), en centavos.
    unit_cost REAL NOT NULL,
    -- Precio de venta de este lote: entra cuando se agota el anterior.
    price INTEGER NOT NULL,
    expires_at TEXT,
    received_at TEXT NOT NULL
  );
  CREATE INDEX lots_fifo ON lots(branch_id, product_id, received_at);
  CREATE TABLE stock_movements (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    product_id TEXT NOT NULL REFERENCES products(id),
    lot_id TEXT REFERENCES lots(id),
    type TEXT NOT NULL CHECK (type IN ('compra','venta','cancelacion','merma','traspaso_salida','traspaso_entrada','ajuste','consumo')),
    qty_milli INTEGER NOT NULL,
    cost INTEGER NOT NULL,
    ref_id TEXT,
    reason TEXT,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX stock_movements_product ON stock_movements(branch_id, product_id);
  CREATE INDEX stock_movements_ref ON stock_movements(ref_id);
  CREATE TRIGGER stock_movements_no_delete BEFORE DELETE ON stock_movements BEGIN SELECT RAISE(ABORT, 'Los movimientos no se pueden borrar'); END;
  CREATE TRIGGER stock_movements_no_update BEFORE UPDATE ON stock_movements BEGIN SELECT RAISE(ABORT, 'Los movimientos no se pueden modificar'); END;
  CREATE TABLE purchase_items (
    id TEXT PRIMARY KEY,
    purchase_id TEXT NOT NULL REFERENCES purchases(id),
    product_id TEXT NOT NULL REFERENCES products(id),
    qty_milli INTEGER NOT NULL,
    cost_total INTEGER NOT NULL,
    freight_share INTEGER NOT NULL,
    unit_cost REAL NOT NULL,
    lot_id TEXT NOT NULL REFERENCES lots(id)
  );
  CREATE TABLE supplier_payments (
    id TEXT PRIMARY KEY,
    purchase_id TEXT NOT NULL REFERENCES purchases(id),
    amount INTEGER NOT NULL CHECK (amount > 0),
    method TEXT NOT NULL CHECK (method IN ('efectivo','transferencia','tarjeta')),
    from_cash_shift TEXT REFERENCES shifts(id),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE transfers (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL,
    from_branch TEXT NOT NULL REFERENCES branches(id),
    to_branch TEXT NOT NULL REFERENCES branches(id),
    items TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  -- Fiado: cargos (+) y abonos (−). Saldo = suma.
  CREATE TABLE credit_ledger (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    delta INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('cargo','abono','cancelacion')),
    method TEXT,
    sale_id TEXT,
    shift_id TEXT,
    note TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX credit_ledger_customer ON credit_ledger(customer_id);
  CREATE TRIGGER credit_ledger_no_delete BEFORE DELETE ON credit_ledger BEGIN SELECT RAISE(ABORT, 'No se puede borrar'); END;
  CREATE TRIGGER credit_ledger_no_update BEFORE UPDATE ON credit_ledger BEGIN SELECT RAISE(ABORT, 'No se puede modificar'); END;
  CREATE TABLE expenses (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL,
    branch_id TEXT NOT NULL REFERENCES branches(id),
    concept TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    kind TEXT NOT NULL CHECK (kind IN ('fijo','variable')),
    method TEXT NOT NULL CHECK (method IN ('efectivo','transferencia','tarjeta')),
    from_cash_shift TEXT REFERENCES shifts(id),
    date TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TRIGGER expenses_no_delete BEFORE DELETE ON expenses BEGIN SELECT RAISE(ABORT, 'No se puede borrar'); END;
  -- Gastos fijos mensuales (renta, luz, agua…) que alimentan la reserva del retiro sugerido.
  CREATE TABLE fixed_expenses (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL,
    concept TEXT NOT NULL,
    monthly_amount INTEGER NOT NULL CHECK (monthly_amount > 0),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  `,
  },
  `
  -- Ferretería: escalas de precio por volumen, clave del proveedor, cotizaciones y devoluciones.
  CREATE TABLE price_tiers (
    product_id TEXT NOT NULL REFERENCES products(id),
    min_milli INTEGER NOT NULL CHECK (min_milli > 0),
    price INTEGER NOT NULL CHECK (price >= 0),
    PRIMARY KEY (product_id, min_milli)
  );
  CREATE TABLE product_suppliers (
    product_id TEXT NOT NULL REFERENCES products(id),
    supplier_id TEXT NOT NULL REFERENCES suppliers(id),
    supplier_code TEXT NOT NULL,
    PRIMARY KEY (product_id, supplier_id),
    UNIQUE (supplier_id, supplier_code)
  );
  CREATE TABLE quotes (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    folio INTEGER NOT NULL,
    customer_id TEXT REFERENCES customers(id),
    customer_name TEXT,
    items TEXT NOT NULL,
    total INTEGER NOT NULL,
    valid_until TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'abierta' CHECK (status IN ('abierta','vendida','cancelada')),
    sale_id TEXT REFERENCES sales(id),
    price_authorized_by TEXT REFERENCES users(id),
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    UNIQUE (business_id, folio)
  );
  CREATE TABLE returns (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    sale_id TEXT REFERENCES sales(id),
    shift_id TEXT REFERENCES shifts(id),
    customer_id TEXT REFERENCES customers(id),
    amount INTEGER NOT NULL CHECK (amount >= 0),
    refund_method TEXT NOT NULL CHECK (refund_method IN ('efectivo','transferencia','tarjeta','saldo')),
    reason TEXT NOT NULL,
    authorized_by TEXT NOT NULL REFERENCES users(id),
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL
  );
  CREATE TABLE return_items (
    id TEXT PRIMARY KEY,
    return_id TEXT NOT NULL REFERENCES returns(id),
    sale_item_id TEXT,
    product_id TEXT REFERENCES products(id),
    description TEXT NOT NULL,
    qty_milli INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    restocked INTEGER NOT NULL DEFAULT 1
  );
  `,
  {
    fkOff: true,
    sql: `
  -- Movimientos de inventario: se agregan devoluciones y fraccionado (decants).
  CREATE TABLE stock_movements_new (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    product_id TEXT NOT NULL REFERENCES products(id),
    lot_id TEXT REFERENCES lots(id),
    type TEXT NOT NULL CHECK (type IN ('compra','venta','cancelacion','merma','traspaso_salida','traspaso_entrada','ajuste','consumo','devolucion','fraccion_salida','fraccion_entrada')),
    qty_milli INTEGER NOT NULL,
    cost INTEGER NOT NULL,
    ref_id TEXT,
    reason TEXT,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  INSERT INTO stock_movements_new SELECT * FROM stock_movements;
  DROP TABLE stock_movements;
  ALTER TABLE stock_movements_new RENAME TO stock_movements;
  CREATE INDEX stock_movements_product ON stock_movements(branch_id, product_id);
  CREATE INDEX stock_movements_ref ON stock_movements(ref_id);
  CREATE TRIGGER stock_movements_no_delete BEFORE DELETE ON stock_movements BEGIN SELECT RAISE(ABORT, 'Los movimientos no se pueden borrar'); END;
  CREATE TRIGGER stock_movements_no_update BEFORE UPDATE ON stock_movements BEGIN SELECT RAISE(ABORT, 'Los movimientos no se pueden modificar'); END;
  `,
  },
  `
  -- Cada giro tiene su sistema sobre la misma base.
  ALTER TABLE businesses ADD COLUMN giro TEXT NOT NULL DEFAULT 'abarrotes';
  `,
  `
  -- Servicios (sin inventario propio): copias, cortes, uñas, tarifas… con precio, duración y atributos.
  CREATE TABLE services (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    name TEXT NOT NULL,
    category TEXT,
    price INTEGER NOT NULL CHECK (price >= 0),
    duration_min INTEGER,
    attrs TEXT NOT NULL DEFAULT '{}',
    machine_id TEXT,
    sheets_per_unit INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  -- Lo que gasta cada servicio o platillo (tinta, papel, gel, insumos…), por unidad vendida.
  -- En millonésimas de la unidad: una copia gasta 1/20 000 de cartucho de tóner.
  CREATE TABLE recipes (
    owner_id TEXT NOT NULL,
    product_id TEXT NOT NULL REFERENCES products(id),
    qty_micro INTEGER NOT NULL CHECK (qty_micro > 0),
    PRIMARY KEY (owner_id, product_id)
  );
  -- Fracción de consumo que aún no completa una milésima; se acumula para no perder nada.
  CREATE TABLE consumption_carry (
    branch_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    micro INTEGER NOT NULL,
    PRIMARY KEY (branch_id, product_id)
  );
  -- Combos / paquetes con un solo precio: al venderse descuentan sus componentes.
  CREATE TABLE combo_items (
    combo_id TEXT NOT NULL REFERENCES products(id),
    product_id TEXT NOT NULL REFERENCES products(id),
    qty_milli INTEGER NOT NULL CHECK (qty_milli > 0),
    PRIMARY KEY (combo_id, product_id)
  );
  ALTER TABLE products ADD COLUMN sellable INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE sale_items ADD COLUMN service_id TEXT REFERENCES services(id);

  -- Papelería: equipos (copiadoras) y lecturas de su contador por turno.
  CREATE TABLE machines (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE counter_readings (
    id TEXT PRIMARY KEY,
    machine_id TEXT NOT NULL REFERENCES machines(id),
    shift_id TEXT NOT NULL REFERENCES shifts(id),
    type TEXT NOT NULL CHECK (type IN ('inicio','fin')),
    value INTEGER NOT NULL CHECK (value >= 0),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (machine_id, shift_id, type)
  );

  -- Encargos con anticipo.
  CREATE TABLE orders (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    folio INTEGER NOT NULL,
    customer_id TEXT REFERENCES customers(id),
    customer_name TEXT,
    phone TEXT,
    description TEXT NOT NULL,
    total INTEGER NOT NULL CHECK (total >= 0),
    deposit INTEGER NOT NULL CHECK (deposit >= 0),
    deposit_sale_id TEXT REFERENCES sales(id),
    final_sale_id TEXT REFERENCES sales(id),
    due_date TEXT,
    status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','listo','entregado','cancelado')),
    cancel_reason TEXT,
    deposit_refunded INTEGER,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (business_id, folio)
  );
  `,
  `
  -- Agenda (barbería, uñas…): quién atiende, sus horarios, bloqueos y citas.
  ALTER TABLE users ADD COLUMN in_agenda INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE staff_schedules (
    user_id TEXT NOT NULL REFERENCES users(id),
    weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    start TEXT NOT NULL,
    end TEXT NOT NULL,
    CHECK (start < end)
  );
  CREATE INDEX staff_schedules_user ON staff_schedules(user_id, weekday);
  CREATE TABLE agenda_blocks (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id),
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE appointments (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    staff_id TEXT REFERENCES users(id),
    customer_id TEXT REFERENCES customers(id),
    customer_name TEXT NOT NULL,
    phone TEXT,
    services TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pendiente','confirmada','en_atencion','atendida','cancelada','no_asistio')),
    source TEXT NOT NULL CHECK (source IN ('mostrador','link','sin_cita')),
    public_token TEXT UNIQUE,
    at_home INTEGER NOT NULL DEFAULT 0,
    address TEXT,
    travel_min INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    sale_id TEXT REFERENCES sales(id),
    cancel_reason TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX appointments_staff ON appointments(staff_id, starts_at);
  -- Combo de servicios: precio fijo que el dueño reparte entre sus servicios (para comisiones).
  CREATE TABLE service_combos (
    combo_id TEXT NOT NULL REFERENCES services(id),
    service_id TEXT NOT NULL REFERENCES services(id),
    share INTEGER NOT NULL CHECK (share >= 0),
    PRIMARY KEY (combo_id, service_id)
  );
  -- Comisiones sin valores predeterminados: solo lo que el dueño configure.
  CREATE TABLE commission_rules (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    staff_id TEXT REFERENCES users(id),
    target_type TEXT NOT NULL CHECK (target_type IN ('service','product','category','all')),
    target_id TEXT,
    rate_bp INTEGER NOT NULL CHECK (rate_bp BETWEEN 0 AND 10000),
    created_at TEXT NOT NULL
  );
  CREATE TABLE sale_commissions (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL,
    sale_id TEXT NOT NULL REFERENCES sales(id),
    sale_item_id TEXT NOT NULL,
    staff_id TEXT NOT NULL REFERENCES users(id),
    base INTEGER NOT NULL,
    rate_bp INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX sale_commissions_staff ON sale_commissions(staff_id, created_at);
  -- Propinas: de quien atendió, aparte del ingreso del negocio y sin comisión.
  CREATE TABLE tips (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL,
    sale_id TEXT NOT NULL REFERENCES sales(id),
    shift_id TEXT NOT NULL REFERENCES shifts(id),
    staff_id TEXT NOT NULL REFERENCES users(id),
    amount INTEGER NOT NULL CHECK (amount > 0),
    method TEXT NOT NULL CHECK (method IN ('efectivo','transferencia','tarjeta')),
    status TEXT NOT NULL DEFAULT 'vigente' CHECK (status IN ('vigente','cancelada')),
    created_at TEXT NOT NULL
  );
  CREATE TRIGGER sale_commissions_no_delete BEFORE DELETE ON sale_commissions BEGIN SELECT RAISE(ABORT, 'No se puede borrar'); END;
  CREATE TRIGGER tips_no_delete BEFORE DELETE ON tips BEGIN SELECT RAISE(ABORT, 'No se puede borrar'); END;
  ALTER TABLE sale_commissions ADD COLUMN status TEXT NOT NULL DEFAULT 'vigente';
  -- Dirección para servicios a domicilio: se guarda por cliente y solo la ve el negocio.
  ALTER TABLE customers ADD COLUMN address TEXT;
  `,
  `
  -- Paquetes de sesiones: N usos en total dentro de su vigencia (además de las membresías por periodo).
  ALTER TABLE membership_plans ADD COLUMN kind TEXT NOT NULL DEFAULT 'periodo';
  ALTER TABLE membership_plans ADD COLUMN validity_days INTEGER;
  -- La clienta elige si todos sus servicios son a domicilio (1) o solo algunos (0, se elige en cada cita).
  ALTER TABLE customers ADD COLUMN home_all INTEGER NOT NULL DEFAULT 0;
  -- Ajustes por negocio (cargo por traslado, etc.).
  CREATE TABLE business_settings (
    business_id TEXT NOT NULL REFERENCES businesses(id),
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (business_id, key)
  );
  `,
  `
  -- Perfumería: variantes (marca, fragancia, ml, presentación) y frascos abiertos para decants.
  ALTER TABLE products ADD COLUMN attrs TEXT NOT NULL DEFAULT '{}';
  CREATE TABLE open_bottles (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL,
    branch_id TEXT NOT NULL REFERENCES branches(id),
    product_id TEXT NOT NULL REFERENCES products(id),
    ml_total REAL NOT NULL,
    ml_remaining REAL NOT NULL CHECK (ml_remaining >= 0),
    cost_per_ml REAL NOT NULL,
    opened_by TEXT NOT NULL,
    opened_at TEXT NOT NULL
  );
  -- Comisiones también por marca.
  CREATE TABLE commission_rules_new (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    staff_id TEXT REFERENCES users(id),
    target_type TEXT NOT NULL CHECK (target_type IN ('service','product','category','brand','all')),
    target_id TEXT,
    rate_bp INTEGER NOT NULL CHECK (rate_bp BETWEEN 0 AND 10000),
    created_at TEXT NOT NULL
  );
  INSERT INTO commission_rules_new SELECT * FROM commission_rules;
  DROP TABLE commission_rules;
  ALTER TABLE commission_rules_new RENAME TO commission_rules;
  `,
  `
  -- Baños públicos (y lugares con entrada): cada acceso queda registrado, con cobro o con pase.
  CREATE TABLE accesses (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    kind TEXT NOT NULL CHECK (kind IN ('cobro','pase')),
    sale_id TEXT REFERENCES sales(id),
    customer_id TEXT REFERENCES customers(id),
    membership_id TEXT,
    services TEXT NOT NULL,
    at TEXT NOT NULL,
    timed_service_id TEXT REFERENCES services(id),
    exited_at TEXT,
    exit_sale_id TEXT REFERENCES sales(id),
    created_by TEXT NOT NULL
  );
  CREATE INDEX accesses_business ON accesses(business_id, at);
  CREATE TRIGGER accesses_no_delete BEFORE DELETE ON accesses BEGIN SELECT RAISE(ABORT, 'No se puede borrar'); END;
  -- Control de limpieza por turno (interno).
  CREATE TABLE cleaning_tasks (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE cleaning_log (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL,
    task_id TEXT NOT NULL REFERENCES cleaning_tasks(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    shift_id TEXT REFERENCES shifts(id),
    at TEXT NOT NULL,
    note TEXT
  );
  CREATE TRIGGER cleaning_log_no_delete BEFORE DELETE ON cleaning_log BEGIN SELECT RAISE(ABORT, 'No se puede borrar'); END;
  `,
  `
  -- Lugar turístico: horarios con aforo, cierres, visitas guiadas y boletos (uno por persona, con QR).
  CREATE TABLE slot_templates (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    start TEXT NOT NULL,
    end TEXT NOT NULL,
    capacity INTEGER NOT NULL CHECK (capacity > 0)
  );
  CREATE TABLE slot_closures (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    date TEXT NOT NULL,
    start TEXT,
    reason TEXT NOT NULL,
    authorized_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL
  );
  CREATE TABLE tours (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    name TEXT NOT NULL,
    date TEXT NOT NULL,
    start TEXT NOT NULL,
    capacity INTEGER NOT NULL CHECK (capacity > 0),
    guide_id TEXT REFERENCES users(id),
    service_id TEXT NOT NULL REFERENCES services(id),
    status TEXT NOT NULL DEFAULT 'abierta' CHECK (status IN ('abierta','cancelada')),
    created_at TEXT NOT NULL
  );
  CREATE TABLE entry_tickets (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    code TEXT NOT NULL UNIQUE,
    service_id TEXT NOT NULL REFERENCES services(id),
    type_name TEXT NOT NULL,
    price INTEGER NOT NULL,
    date TEXT NOT NULL,
    start TEXT NOT NULL,
    tour_id TEXT REFERENCES tours(id),
    channel TEXT NOT NULL CHECK (channel IN ('taquilla','en_linea')),
    status TEXT NOT NULL CHECK (status IN ('por_pagar','pagado','usado','cancelado')),
    sale_id TEXT REFERENCES sales(id),
    order_token TEXT,
    buyer_name TEXT,
    phone TEXT,
    used_at TEXT,
    cancel_reason TEXT,
    cancelled_by TEXT,
    refunded INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX entry_tickets_slot ON entry_tickets(business_id, date, start);
  CREATE INDEX entry_tickets_order ON entry_tickets(order_token);
  CREATE TRIGGER entry_tickets_no_delete BEFORE DELETE ON entry_tickets BEGIN SELECT RAISE(ABORT, 'No se puede borrar'); END;
  CREATE TABLE occupancy_events (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('entrada','salida')),
    ticket_id TEXT,
    count INTEGER NOT NULL DEFAULT 1,
    at TEXT NOT NULL,
    created_by TEXT NOT NULL
  );
  `,
  `
  -- Platillos y bebidas preparadas: no llevan existencia propia, descuentan su receta.
  ALTER TABLE products ADD COLUMN track_stock INTEGER NOT NULL DEFAULT 1;

  -- Palapa / restaurante / comedor / taquería: mesas, cuentas abiertas, comandas por estación.
  CREATE TABLE dining_tables (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    name TEXT NOT NULL,
    area TEXT NOT NULL DEFAULT 'salon',
    seats INTEGER NOT NULL DEFAULT 4,
    status TEXT NOT NULL DEFAULT 'libre' CHECK (status IN ('libre','ocupada','reservada','por_cobrar','limpieza')),
    min_consumption INTEGER,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE tabs (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    kind TEXT NOT NULL CHECK (kind IN ('mesa','llevar','recoger')),
    table_id TEXT REFERENCES dining_tables(id),
    waiter_id TEXT REFERENCES users(id),
    people INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL CHECK (status IN ('abierta','por_cobrar','cerrada','cancelada')),
    order_number INTEGER,
    order_status TEXT CHECK (order_status IN ('recibido','en_cocina','listo','entregado')),
    customer_name TEXT,
    phone TEXT,
    pickup_at TEXT,
    opened_by TEXT NOT NULL,
    opened_at TEXT NOT NULL,
    closed_at TEXT
  );
  CREATE INDEX tabs_open ON tabs(business_id, status);
  CREATE TABLE comandas (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL,
    tab_id TEXT NOT NULL REFERENCES tabs(id),
    station TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'en_preparacion' CHECK (status IN ('en_preparacion','lista','entregada')),
    created_at TEXT NOT NULL,
    ready_at TEXT
  );
  CREATE INDEX comandas_station ON comandas(business_id, station, status);
  CREATE TABLE tab_items (
    id TEXT PRIMARY KEY,
    tab_id TEXT NOT NULL REFERENCES tabs(id),
    product_id TEXT REFERENCES products(id),
    service_id TEXT REFERENCES services(id),
    description TEXT NOT NULL,
    quantity REAL NOT NULL CHECK (quantity > 0),
    unit_price INTEGER NOT NULL,
    modifiers TEXT NOT NULL DEFAULT '[]',
    notes TEXT,
    station TEXT,
    person INTEGER,
    status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','enviado','listo','entregado','cancelado','pagado')),
    comanda_id TEXT REFERENCES comandas(id),
    courtesy INTEGER NOT NULL DEFAULT 0,
    authorized_by TEXT REFERENCES users(id),
    cancel_reason TEXT,
    sale_id TEXT REFERENCES sales(id),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX tab_items_tab ON tab_items(tab_id);
  CREATE TABLE table_reservations (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    table_id TEXT REFERENCES dining_tables(id),
    starts_at TEXT NOT NULL,
    people INTEGER NOT NULL CHECK (people > 0),
    name TEXT NOT NULL,
    phone TEXT,
    notes TEXT,
    status TEXT NOT NULL CHECK (status IN ('pendiente','confirmada','llego','no_llego','cancelada')),
    confirmed_by TEXT REFERENCES users(id),
    created_by TEXT,
    created_at TEXT NOT NULL
  );
  -- Renta de activos (sillas, camastros, sombrillas) con su propio control.
  CREATE TABLE rental_assets (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    name TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity >= 0),
    price INTEGER NOT NULL CHECK (price >= 0),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE asset_rentals (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL REFERENCES rental_assets(id),
    tab_id TEXT NOT NULL REFERENCES tabs(id),
    tab_item_id TEXT NOT NULL REFERENCES tab_items(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    out_at TEXT NOT NULL,
    returned_at TEXT
  );
  CREATE TRIGGER tab_items_no_delete BEFORE DELETE ON tab_items BEGIN SELECT RAISE(ABORT, 'No se puede borrar'); END;
  CREATE TRIGGER tabs_no_delete BEFORE DELETE ON tabs BEGIN SELECT RAISE(ABORT, 'No se puede borrar'); END;
  `,
  `
  -- Comedor / taquería: menú (o guisados) del día por turno de comida, con agotados.
  CREATE TABLE daily_menus (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    date TEXT NOT NULL,
    meal TEXT NOT NULL DEFAULT 'dia',
    items TEXT NOT NULL,
    published_by TEXT NOT NULL REFERENCES users(id),
    authorized_by TEXT NOT NULL REFERENCES users(id),
    published_at TEXT NOT NULL,
    UNIQUE (business_id, date, meal)
  );
  -- Turno de comida del corte (desayuno, comida, cena).
  ALTER TABLE shifts ADD COLUMN meal TEXT;
  `,
  `
  -- Taquería: carne del trompo o asada. Se registra lo que se empieza; lo vendido sale de las recetas; al cierre se cuenta el sobrante con código.
  CREATE TABLE meat_batches (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    branch_id TEXT NOT NULL REFERENCES branches(id),
    product_id TEXT NOT NULL REFERENCES products(id),
    shift_id TEXT REFERENCES shifts(id),
    started_milli INTEGER NOT NULL CHECK (started_milli > 0),
    started_at TEXT NOT NULL,
    started_by TEXT NOT NULL,
    closed_at TEXT,
    sold_milli INTEGER,
    expected_milli INTEGER,
    counted_milli INTEGER,
    difference_milli INTEGER,
    reason TEXT,
    authorized_by TEXT REFERENCES users(id)
  );
  `,
  `
  -- Super panel: verificación en dos pasos por SMS y correo.
  ALTER TABLE admins ADD COLUMN phone TEXT;
  ALTER TABLE admins ADD COLUMN email TEXT;
  CREATE TABLE admin_challenges (
    id TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL REFERENCES admins(id),
    code_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL
  );
  -- Extras de pago (p. ej. instalación del link de reservas): solo el super panel los habilita.
  ALTER TABLE businesses ADD COLUMN addons TEXT NOT NULL DEFAULT '[]';
  UPDATE businesses SET addons = '["reservas"]' WHERE modules LIKE '%reservas%';
  -- Cobros únicos (instalaciones). Nunca se borran.
  CREATE TABLE one_time_charges (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    concept TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount >= 0),
    recorded_by TEXT NOT NULL REFERENCES admins(id),
    created_at TEXT NOT NULL
  );
  CREATE TRIGGER one_time_charges_no_delete BEFORE DELETE ON one_time_charges BEGIN SELECT RAISE(ABORT, 'No se puede borrar'); END;
  `,
  {
    fkOff: true,
    sql: `
  -- Códigos al teléfono del dueño: también para recuperar la cuenta y para que el super panel verifique su identidad.
  CREATE TABLE verification_codes_new (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    purpose TEXT NOT NULL CHECK (purpose IN ('registro','login','recuperar','identidad')),
    code_hash TEXT NOT NULL,
    device_id TEXT,
    device_name TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL
  );
  INSERT INTO verification_codes_new SELECT * FROM verification_codes;
  DROP TABLE verification_codes;
  ALTER TABLE verification_codes_new RENAME TO verification_codes;
  `,
  },
  `
  -- Equipos de confianza del dueño: tras verificar con SMS, ese equipo no vuelve a pedir código en 30 días.
  CREATE TABLE trusted_devices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    token_hash TEXT NOT NULL UNIQUE,
    device_name TEXT,
    created_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT
  );
  `,
  `
  -- Negocios mixtos: además del giro principal, otros giros cuyas pantallas también se usan (p. ej. abarrotes + papelería).
  ALTER TABLE businesses ADD COLUMN extra_giros TEXT NOT NULL DEFAULT '[]';
  `,
  `
  -- Contabilidad: categoría de cada gasto (para el estado de resultados).
  ALTER TABLE expenses ADD COLUMN category TEXT NOT NULL DEFAULT 'otros';
  -- Origen de los movimientos de caja: 'manual' (retiro o depósito que hizo alguien) o 'sistema'
  -- (abonos, gastos, compras y devoluciones, que ya se cuentan en su propia tabla).
  ALTER TABLE cash_movements ADD COLUMN origin TEXT NOT NULL DEFAULT 'sistema';
  UPDATE cash_movements SET origin = 'manual'
   WHERE reason NOT LIKE 'Abono de %' AND reason NOT LIKE 'Gasto: %' AND reason NOT LIKE 'Devolución%'
     AND reason NOT LIKE 'Pago de compra %' AND reason NOT LIKE 'Abono a proveedor %' AND reason NOT LIKE 'Reembolso de boletos%';
  `,
]

/** Aplica las migraciones pendientes (en orden, cada una en su transacción). */
export function migrate(db: Db): Db {
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY)')
  const done = new Set((db.prepare('SELECT version FROM _migrations').all() as { version: number }[]).map((r) => r.version))
  MIGRATIONS.forEach((m, i) => {
    if (done.has(i + 1)) return
    const sql = typeof m === 'string' ? m : m.sql
    // Reconstruir una tabla (p. ej. para cambiar un CHECK) exige apagar las llaves foráneas fuera de la transacción.
    if (typeof m !== 'string') db.pragma('foreign_keys = OFF')
    db.transaction(() => {
      db.exec(sql)
      if (typeof m !== 'string') {
        const bad = db.pragma('foreign_key_check') as unknown[]
        if (bad.length) throw new Error(`Migración ${i + 1}: llaves foráneas rotas`)
      }
      db.prepare('INSERT INTO _migrations (version) VALUES (?)').run(i + 1)
    })()
    if (typeof m !== 'string') db.pragma('foreign_keys = ON')
  })
  return db
}
