/** Giros de NEXORA con su nombre para mostrar (mismo orden que la spec). */
export const GIROS: Record<string, string> = {
  abarrotes: 'Abarrotes', ferreteria: 'Ferretería', papeleria: 'Papelería', barberia: 'Barbería', unas: 'Estudio de uñas', perfumeria: 'Perfumería',
  banos: 'Baños públicos', turistico: 'Lugar turístico', palapa: 'Palapa', restaurante: 'Restaurante', comedor: 'Comedor', taqueria: 'Taquería', verduleria: 'Verdulería',
}
export const giroLabel = (g: string) => GIROS[g] ?? g
