export interface ClientConfig {
  mapsApiKey: string | null;
  mapId: string | null;
  defaultCenter: { lat: number; lng: number };
  /** Name the operator signed in with (shown on acknowledgements). */
  operator: string;
}
