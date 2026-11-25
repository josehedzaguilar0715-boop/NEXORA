import { Clock, Facebook, Instagram, MapPin, Phone } from 'lucide-react'
import { Foto } from './ilustraciones'

export interface PerfilPub { descripcion: string; direccion: string; horario: string; instagram: string; facebook: string; portadaUrl: string | null }

/** Portada y datos del negocio, iguales en reservas, menú y listas: logo, nombre, descripción, horario, dirección y redes. */
export function EncabezadoNegocio({ business, profile, horarioAuto }: { business: { name: string; phone?: string | null; giro: string; logoUrl?: string | null }; profile?: PerfilPub; horarioAuto?: string }) {
  const horario = profile?.horario || horarioAuto
  return (
    <header className="perfil-pub">
      <Foto url={profile?.portadaUrl} giro={business.giro} alto={190} radio={18} alt={`Portada de ${business.name}`} />
      <div className="perfil-pub-id">
        {business.logoUrl && <img className="perfil-logo" src={business.logoUrl} alt={`Logotipo de ${business.name}`} referrerPolicy="no-referrer" />}
        <div>
          <h1>{business.name}</h1>
          {profile?.descripcion && <p>{profile.descripcion}</p>}
        </div>
      </div>
      <ul className="perfil-datos">
        {horario && <li><Clock size={18} aria-hidden />{horario}</li>}
        {profile?.direccion && <li><MapPin size={18} aria-hidden />{profile.direccion}</li>}
        {business.phone && <li><Phone size={18} aria-hidden /><a href={`tel:${business.phone}`}>{business.phone}</a></li>}
        {profile?.instagram && <li><Instagram size={18} aria-hidden /><a href={`https://instagram.com/${encodeURIComponent(profile.instagram)}`} target="_blank" rel="noopener noreferrer">@{profile.instagram}</a></li>}
        {profile?.facebook && <li><Facebook size={18} aria-hidden /><a href={profile.facebook} target="_blank" rel="noopener noreferrer">Facebook</a></li>}
      </ul>
    </header>
  )
}
