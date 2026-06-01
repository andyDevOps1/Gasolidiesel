// Importaciones de Angular
import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, NgZone, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';

// Interfaz de una estación de gasolina desde la API
interface ApiStation {
  Latitud?: string; // Latitud de la estación
  Longitud?: string; // Longitud de la estación
  'Longitud (WGS84)'?: string; // Longitud en formato WGS84
  'Longitud_x0020__x0028_WGS84_x0029_'?: string; // Longitud codificada en espacios
  'Rótulo'?: string; // Nombre de la marca/empresa
  Dirección?: string; // Dirección completa
  Horario?: string; // Horario de apertura
  Localidad?: string; // Localidad/ciudad
  Provincia?: string; // Provincia
  Municipio?: string; // Municipio
  PrecioProducto?: string; // Precio del producto
  [key: string]: unknown; // Permite otras propiedades desconocidas
}

// Interfaz para la respuesta de la API
interface ApiResponse {
  ListaEESSPrecio?: ApiStation[]; // Lista de estaciones con precios
}

// Interfaz para provincias de la API
interface ApiProvincia {
  IDPovincia?: string; // ID de provincia (typo en la API)
  IDProvincia?: string; // ID de provincia (correcto)
  Provincia: string; // Nombre de la provincia
}

// Interfaz para comunidades autónomas de la API
interface ApiComunidad {
  IDCCAA: string; // ID de comunidad autónoma
  CCAA: string; // Nombre de comunidad autónoma
}

// Interfaz para productos petroleros de la API
interface ApiProducto {
  IDProducto: string; // ID del producto
  NombreProducto: string; // Nombre del producto (ej: Gasolina 95)
}

// Interfaz para opciones de carburantes
interface Carburante {
  id: string; // ID del carburante
  label: string; // Etiqueta mostrada al usuario
}

// Interfaz para gasolineras mostradas
interface GasolineraView {
  empresa: string; // Nombre de la empresa/marca
  direccion: string; // Dirección completa
  horario: string; // Horario de apertura
  localidad: string; // Localidad
  provincia: string; // Provincia
  lat: number; // Latitud
  lon: number; // Longitud
  distanciaKm: number; // Distancia en kilómetros desde la búsqueda
  precio: number | null; // Precio del carburante (null si no disponible)
  barata?: boolean; // Indica si es la más barata de los resultados
}

// Interfaz para resultados de búsqueda de geolocalización
interface NominatimSearchResult {
  lat: string; // Latitud en formato string
  lon: string; // Longitud en formato string
  display_name: string; // Nombre completo de la ubicación
  address?: {
    state?: string; // Estado/región
    province?: string; // Provincia
    county?: string; // Condado
    postcode?: string; // Código postal
  };
}

// Diferentes tipos de búsqueda disponibles
type TipoBusqueda = 'direccion' | 'ubicacion' | 'provincia' | 'comunidad';
// Tipo para los servicios de combustible disponibles
type TipoServicio = 'EstacionesTerrestres' | 'PostesMaritimos';

@Component({
  selector: 'app-inicio',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './inicio.html',
  styleUrl: './inicio.css',
})
// Componente principal
export class Inicio implements OnInit {
  tipoBusqueda: TipoBusqueda = 'direccion';
  tipoServicio: TipoServicio = 'EstacionesTerrestres';

  filtroFechaActivo = false;
  fechaFiltro = '';

  direccion = '';
  numGas: number | string = 5;
  radioKm: number | string = 10;

  carburantes: Carburante[] = [];
  IdCarburante = '';

  provincias: ApiProvincia[] = [];
  comunidades: ApiComunidad[] = [];

  provinciaSeleccionada = '';
  comunidadSeleccionada = '';

  empresasTop: string[] = [
    'TODAS',
    'REPSOL',
    'CEPSA',
    'BP',
    'SHELL',
    'GALP',
    'MOEVE',
    'AVIA',
    'PLENOIL',
    'PETROPRIX',
    'BALLENOIL',
    'Q8',
    'CARREFOUR',
    'EROSKI',
    'DISA',
  ];

  empresaSeleccionada = 'TODAS';

  loading = false;
  error = '';
  info = '';
  ubicacionTexto = '';

  userLat: number | null = null;
  userLon: number | null = null;

  results: GasolineraView[] = [];

  private provinciasCache: ApiProvincia[] | null = null;
  private comunidadesCache: ApiComunidad[] | null = null;
  private estacionesCache = new Map<string, ApiStation[]>();

  constructor(private cdr: ChangeDetectorRef, private zone: NgZone) {}

  get fuelLabel(): string {
    return this.carburantes.find(x => x.id === this.IdCarburante)?.label ?? 'Carburante';
  }

  // Método que se ejecuta al iniciar el componente
  async ngOnInit(): Promise<void> {
    await this.cargarCatalogoCombustibles();
    await this.cargarFiltrosUbicacion();
    this.forzarRender();
  }

  // Método principal para obtener dirección y buscar estaciones
  async obtenerDireccionYBuscar(): Promise<void> {
    this.setUi({
      error: '',
      info: '',
      results: [],
      ubicacionTexto: '',
    });

    if (this.filtroFechaActivo && !this.fechaFiltro) {
      this.setUi({ error: 'Activa una fecha válida o desmarca el filtro por fecha.' });
      return;
    }

    if (this.tipoBusqueda === 'direccion') {
      await this.buscarPorDireccion();
      return;
    }

    if (this.tipoBusqueda === 'ubicacion') {
      await this.buscarPorUbicacionActual();
      return;
    }

    if (this.tipoBusqueda === 'provincia') {
      await this.buscarPorProvincia();
      return;
    }

    if (this.tipoBusqueda === 'comunidad') {
      await this.buscarPorComunidad();
      return;
    }
  }

  // Método para buscar estaciones por dirección ingresada
  private async buscarPorDireccion(): Promise<void> {
    const q = this.direccion.trim();

    if (!q) {
      this.setUi({ error: 'Introduce una dirección o código postal.' });
      return;
    }

    this.setUi({
      loading: true,
      info: 'Convirtiendo dirección a coordenadas...',
      error: '',
    });

    try {
      const geo = await this.geocodeNominatim(q);

      this.ui(() => {
        this.userLat = geo.lat;
        this.userLon = geo.lon;
        this.ubicacionTexto = geo.display;
      });

      await this.buscarCercanas(geo.postcode ?? null);
    } catch {
      this.setUi({ error: 'No se pudo obtener la ubicación de esa dirección.' });
    } finally {
      this.setUi({ loading: false });
    }
  }

  // Método para buscar estaciones usando la ubicación actual del dispositivo
  private async buscarPorUbicacionActual(): Promise<void> {
    if (!navigator.geolocation) {
      this.setUi({ error: 'Tu navegador no permite obtener la ubicación.' });
      return;
    }

    this.setUi({
      loading: true,
      info: 'Obteniendo ubicación actual...',
      error: '',
      results: [],
    });

    navigator.geolocation.getCurrentPosition(
      async pos => {
        try {
          this.ui(() => {
            this.userLat = pos.coords.latitude;
            this.userLon = pos.coords.longitude;
            this.ubicacionTexto = 'Ubicación actual del dispositivo';
          });

          await this.buscarCercanas(null);
        } catch {
          this.setUi({ error: 'No se pudo buscar con tu ubicación.' });
        } finally {
          this.setUi({ loading: false });
        }
      },
      () => {
        this.setUi({
          loading: false,
          error: 'No se pudo obtener la ubicación. Revisa los permisos del navegador.',
        });
      }
    );
  }

  // Método para buscar estaciones por provincia seleccionada
  private async buscarPorProvincia(): Promise<void> {
    if (!this.provinciaSeleccionada) {
      this.setUi({ error: 'Selecciona una provincia.' });
      return;
    }

    this.setUi({
      loading: true,
      info: 'Buscando por provincia...',
      error: '',
      results: [],
    });

    try {
      const idProducto = this.IdCarburante || this.carburantes[0]?.id || '1';
      const limit = this.normalizarLimite(this.numGas);

      const estaciones = await this.getEstacionesProvinciaProducto(this.provinciaSeleccionada, idProducto);

      let lista = this.mapearEstacionesSinDistancia(estaciones);
      lista = this.filtrarPorEmpresa(lista);
      lista.sort((a, b) => (a.precio ?? Infinity) - (b.precio ?? Infinity));

      const finalList = limit ? lista.slice(0, limit) : lista;

      this.masBarata(finalList);

      this.setUi({
        results: finalList,
        info: `Mostrando ${finalList.length} resultados de la provincia seleccionada.`,
      });
    } catch {
      this.setUi({ error: 'Error buscando por provincia.' });
    } finally {
      this.setUi({ loading: false });
    }
  }

  // Método para buscar estaciones por comunidad autónoma seleccionada
  private async buscarPorComunidad(): Promise<void> {
    if (!this.comunidadSeleccionada) {
      this.setUi({ error: 'Selecciona una comunidad autónoma.' });
      return;
    }

    this.setUi({
      loading: true,
      info: 'Buscando por comunidad autónoma...',
      error: '',
      results: [],
    });

    try {
      const idProducto = this.IdCarburante || this.carburantes[0]?.id || '1';
      const limit = this.normalizarLimite(this.numGas);

      const estaciones = await this.getEstacionesComunidadProducto(this.comunidadSeleccionada, idProducto);

      let lista = this.mapearEstacionesSinDistancia(estaciones);
      lista = this.filtrarPorEmpresa(lista);
      lista.sort((a, b) => (a.precio ?? Infinity) - (b.precio ?? Infinity));

      const finalList = limit ? lista.slice(0, limit) : lista;

      this.masBarata(finalList);

      this.setUi({
        results: finalList,
        info: `Mostrando ${finalList.length} resultados de la comunidad seleccionada.`,
      });
    } catch {
      this.setUi({ error: 'Error buscando por comunidad autónoma.' });
    } finally {
      this.setUi({ loading: false });
    }
  }

  // Método para buscar estaciones cercanas a unas coordenadas dadas
  private async buscarCercanas(postcode: string | null): Promise<void> {
    this.setUi({
      error: '',
      info: '',
      results: [],
    });

    const lat = this.userLat;
    const lon = this.userLon;

    if (lat == null || lon == null) {
      this.setUi({ error: 'No hay coordenadas. Revisa la dirección o ubicación.' });
      return;
    }

    const idProducto = this.IdCarburante || this.carburantes[0]?.id || '1';
    const km = this.normalizarKm(this.radioKm);
    const limit = this.normalizarLimite(this.numGas);

    this.setUi({ info: `Buscando resultados en ${km} km...` });

    try {
      const idProvincia = await this.getProvinciaIdRobusta(lat, lon, postcode);
      const estaciones = await this.getEstacionesProvinciaProducto(idProvincia, idProducto);

      const found = this.filtrarPorDistancia(estaciones, lat, lon, km);

      if (!found.length) {
        this.setUi({ info: `0 resultados en ${km} km.` });
        return;
      }

      found.sort((a, b) => a.distanciaKm - b.distanciaKm);

      const finalList = limit ? found.slice(0, limit) : found;

      this.masBarata(finalList);

      const idx = finalList.findIndex(x => x.barata);
      if (idx > 0) {
        finalList.unshift(finalList.splice(idx, 1)[0]);
      }

      this.setUi({
        results: [...finalList],
        info: `Mostrando ${finalList.length} de ${found.length} encontrados en ${km} km.`,
      });
    } catch {
      this.setUi({ error: 'Error buscando resultados.' });
    }
  }

  // Método para cargar el catálogo de carburantes desde la API
  private async cargarCatalogoCombustibles(): Promise<void> {
    try {
      const resp = await fetch('/carburantes/PreciosCarburantes/Listados/ProductosPetroliferos/', {
        headers: { Accept: 'application/json' },
      });

      const productos = (await resp.json()) as ApiProducto[];

      const opts = (productos ?? [])
        .filter(p => p?.IDProducto && p?.NombreProducto)
        .map(p => ({
          id: String(p.IDProducto),
          label: String(p.NombreProducto),
        }))
        .sort((a, b) => a.label.localeCompare(b.label, 'es'));

      this.ui(() => {
        this.carburantes = opts;

        if (!this.IdCarburante) {
          const preferidos = ['Gasolina 95', 'Gasóleo A', 'Gasoleo A'].map(x => x.toLowerCase());
          const encontrado = opts.find(o => preferidos.some(p => o.label.toLowerCase().includes(p)));
          this.IdCarburante = encontrado?.id ?? opts[0]?.id ?? '1';
        }
      });
    } catch {
      this.ui(() => {
        this.carburantes = [{ id: '1', label: 'Gasolina 95' }];
        this.IdCarburante = this.IdCarburante || '1';
      });
    }
  }

  // Método para cargar las provincias y comunidades autónomas desde la API
  private async cargarFiltrosUbicacion(): Promise<void> {
    try {
      const [provincias, comunidades] = await Promise.all([
        this.getProvincias(),
        this.getComunidades(),
      ]);

      this.ui(() => {
        this.provincias = provincias;
        this.comunidades = comunidades;
      });
    } catch {
      this.setUi({ error: 'No se pudieron cargar provincias o comunidades.' });
    }
  }

  // Método para geocodificar una dirección usando Nominatim
  private async geocodeNominatim(q: string): Promise<{ lat: number; lon: number; display: string; postcode?: string }> {
    const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&countrycodes=es&q=${encodeURIComponent(q)}`;

    const r = await fetch(url, {
      headers: { Accept: 'application/json' },
    });

    if (!r.ok) throw new Error();

    const data = (await r.json()) as NominatimSearchResult[];

    if (!data.length) throw new Error();

    const lat = this.num(data[0].lat);
    const lon = this.num(data[0].lon);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error();

    return {
      lat,
      lon,
      display: data[0].display_name || q,
      postcode: data[0].address?.postcode,
    };
  }

  // Método para obtener el ID de provincia de forma robusta usando coordenadas y código postal
  private async getProvinciaIdRobusta(
    lat: number,
    lon: number,
    postcodeFromSearch: string | null
  ): Promise<string> {
    let provName: string | null = null;
    let postcode: string | null = postcodeFromSearch;

    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&countrycodes=es&lat=${lat}&lon=${lon}`;

      const r = await fetch(url, {
        headers: { Accept: 'application/json' },
      });

      const data = await r.json();

      provName =
        data?.address?.state ||
        data?.address?.province ||
        data?.address?.county ||
        null;

      postcode = postcode || data?.address?.postcode || null;
    } catch {}

    if (provName) {
      const provincias = await this.getProvincias();
      const target = this.limpiarParaMatch(String(provName));

      const hit = provincias.find(p => {
        const name = this.limpiarParaMatch(String(p.Provincia ?? ''));
        return name === target || name.includes(target) || target.includes(name);
      });

      if (hit) {
        return String(hit.IDProvincia ?? hit.IDPovincia ?? '00').padStart(2, '0');
      }
    }

    const pc = postcode?.trim();

    if (pc && pc.length >= 2) {
      const code2 = pc.slice(0, 2);
      if (/^\d{2}$/.test(code2)) return code2;
    }

    return '00';
  }

  // Método para obtener la lista de provincias desde la API con caché
  private async getProvincias(): Promise<ApiProvincia[]> {
    if (this.provinciasCache) return this.provinciasCache;

    const resp = await fetch('/carburantes/PreciosCarburantes/Listados/Provincias/', {
      headers: { Accept: 'application/json' },
    });

    this.provinciasCache = ((await resp.json()) as ApiProvincia[]) ?? [];
    return this.provinciasCache;
  }

  // Método para obtener la lista de comunidades autónomas desde la API con caché
  private async getComunidades(): Promise<ApiComunidad[]> {
    if (this.comunidadesCache) return this.comunidadesCache;

    const resp = await fetch('/carburantes/PreciosCarburantes/Listados/ComunidadesAutonomas/', {
      headers: { Accept: 'application/json' },
    });

    this.comunidadesCache = ((await resp.json()) as ApiComunidad[]) ?? [];
    return this.comunidadesCache;
  }

  // Método para obtener estaciones por provincia y producto con caché
  private async getEstacionesProvinciaProducto(
    idProvincia: string,
    idProducto: string
  ): Promise<ApiStation[]> {
    const fecha = this.getFechaApi();
    const key = `${this.tipoServicio}_provincia_${fecha ?? 'actual'}_${idProvincia}_${idProducto}`;
    const cached = this.estacionesCache.get(key);

    if (cached) return cached;

    let url = '';

    if (fecha) {
      url =
        `/carburantes/PreciosCarburantes/${this.tipoServicio}Hist/FiltroProvinciaProducto/${fecha}/${idProvincia}/${idProducto}`;
    } else {
      url =
        `/carburantes/PreciosCarburantes/${this.tipoServicio}/FiltroProvinciaProducto/${idProvincia}/${idProducto}`;
    }

    const resp = await fetch(url, {
      headers: { Accept: 'application/json' },
    });

    const data = (await resp.json()) as ApiResponse;
    const estaciones = data?.ListaEESSPrecio ?? [];

    this.estacionesCache.set(key, estaciones);
    return estaciones;
  }

  // Método para obtener estaciones por comunidad autónoma y producto con caché
  private async getEstacionesComunidadProducto(
    idComunidad: string,
    idProducto: string
  ): Promise<ApiStation[]> {
    const fecha = this.getFechaApi();
    const key = `${this.tipoServicio}_comunidad_${fecha ?? 'actual'}_${idComunidad}_${idProducto}`;
    const cached = this.estacionesCache.get(key);

    if (cached) return cached;

    let url = '';

    if (fecha) {
      url =
        `/carburantes/PreciosCarburantes/${this.tipoServicio}Hist/FiltroCCAAProducto/${fecha}/${idComunidad}/${idProducto}`;
    } else {
      url =
        `/carburantes/PreciosCarburantes/${this.tipoServicio}/FiltroCCAAProducto/${idComunidad}/${idProducto}`;
    }

    const resp = await fetch(url, {
      headers: { Accept: 'application/json' },
    });

    const data = (await resp.json()) as ApiResponse;
    const estaciones = data?.ListaEESSPrecio ?? [];

    this.estacionesCache.set(key, estaciones);
    return estaciones;
  }

  // Método para obtener la fecha en formato API si el filtro de fecha está activo
  private getFechaApi(): string | null {
    if (!this.filtroFechaActivo || !this.fechaFiltro) {
      return null;
    }

    const partes = this.fechaFiltro.split('-');

    if (partes.length !== 3) {
      return null;
    }

    const yyyy = partes[0];
    const mm = partes[1];
    const dd = partes[2];

    return `${dd}-${mm}-${yyyy}`;
  }

  // Método para filtrar estaciones por distancia desde unas coordenadas
  private filtrarPorDistancia(
    estaciones: ApiStation[],
    lat: number,
    lon: number,
    maxKm: number
  ): GasolineraView[] {
    const candidatos = this.filtrarPorCajas(estaciones, lat, lon, maxKm);
    const filtraEmpresa = this.empresaSeleccionada && this.empresaSeleccionada !== 'TODAS';

    const out: GasolineraView[] = [];

    for (const e of candidatos) {
      const la = this.coord(e, ['Latitud']);
      const lo = this.coord(e, [
        'Longitud (WGS84)',
        'Longitud_x0020__x0028_WGS84_x0029_',
        'Longitud',
      ]);

      if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;

      const d = this.distancia(lat, lon, la, lo);

      if (d > maxKm) continue;

      const empresa = this.normalizarEmpresa(String(e['Rótulo'] ?? ''));

      if (filtraEmpresa && empresa !== this.empresaSeleccionada) continue;

      out.push({
        empresa,
        direccion: String(e['Dirección'] ?? '').trim(),
        horario: String(e['Horario'] ?? '').trim(),
        localidad: String((e['Localidad'] ?? e['Municipio'] ?? '') as string).trim(),
        provincia: String(e['Provincia'] ?? '').trim(),
        lat: la,
        lon: lo,
        distanciaKm: d,
        precio: this.parsePrecio(e['PrecioProducto']),
      });
    }

    return out;
  }

  // Método para mapear estaciones sin calcular distancia (provincia/comunidad)
  private mapearEstacionesSinDistancia(estaciones: ApiStation[]): GasolineraView[] {
    const out: GasolineraView[] = [];

    for (const e of estaciones) {
      const la = this.coord(e, ['Latitud']);
      const lo = this.coord(e, [
        'Longitud (WGS84)',
        'Longitud_x0020__x0028_WGS84_x0029_',
        'Longitud',
      ]);

      out.push({
        empresa: this.normalizarEmpresa(String(e['Rótulo'] ?? '')),
        direccion: String(e['Dirección'] ?? '').trim(),
        horario: String(e['Horario'] ?? '').trim(),
        localidad: String((e['Localidad'] ?? e['Municipio'] ?? '') as string).trim(),
        provincia: String(e['Provincia'] ?? '').trim(),
        lat: Number.isFinite(la) ? la : 0,
        lon: Number.isFinite(lo) ? lo : 0,
        distanciaKm: 0,
        precio: this.parsePrecio(e['PrecioProducto']),
      });
    }

    return out;
  }

  // Método para filtrar una lista de estaciones por empresa
  private filtrarPorEmpresa(lista: GasolineraView[]): GasolineraView[] {
    if (!this.empresaSeleccionada || this.empresaSeleccionada === 'TODAS') {
      return lista;
    }

    return lista.filter(g => g.empresa === this.empresaSeleccionada);
  }

  private coord(e: ApiStation, keys: string[]): number {
    for (const k of keys) {
      const v = e[k];

      if (v != null && String(v).trim() !== '') {
        return this.num(v);
      }
    }

    return NaN;
  }

  // Método para filtrar estaciones usando un método de cajas geográficas para optimizar la búsqueda
  private filtrarPorCajas(
    estaciones: ApiStation[],
    lat: number,
    lon: number,
    maxKm: number
  ): ApiStation[] {
    const latDelta = maxKm / 111;
    const lonDelta = maxKm / (111 * Math.cos((lat * Math.PI) / 180));

    const minLat = lat - latDelta;
    const maxLat = lat + latDelta;
    const minLon = lon - lonDelta;
    const maxLon = lon + lonDelta;

    const out: ApiStation[] = [];

    for (const e of estaciones) {
      const la = this.coord(e, ['Latitud']);
      const lo = this.coord(e, [
        'Longitud (WGS84)',
        'Longitud_x0020__x0028_WGS84_x0029_',
        'Longitud',
      ]);

      if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;

      if (la >= minLat && la <= maxLat && lo >= minLon && lo <= maxLon) {
        out.push(e);
      }
    }

    return out;
  }

  // Método para marcar la estación más barata en una lista de estaciones
  private masBarata(list: GasolineraView[]): void {
    let mejor: GasolineraView | null = null;

    for (const x of list) {
      x.barata = false;

      if (x.precio == null) continue;

      if (!mejor || x.precio < (mejor.precio ?? Infinity)) {
        mejor = x;
      }
    }

    if (mejor) mejor.barata = true;
  }

  // Método para normalizar el límite de resultados a mostrar
  private normalizarLimite(v: unknown): number {
    const n = Math.trunc(Number(v));

    if (!Number.isFinite(n)) return 50;
    if (n <= 0) return 0;

    return Math.min(5000, n);
  }

  // Método para normalizar el radio de búsqueda en kilómetros
  private normalizarKm(v: unknown): number {
    const n = Number(v);

    if (!Number.isFinite(n) || n <= 0) return 2;

    return Math.min(100, n);
  }

  // Método para convertir un valor a número manejando comas y espacios
  private num(v: unknown): number {
    const s = String(v ?? '').trim();

    if (!s) return NaN;

    const n = Number(s.replace(',', '.'));

    return Number.isFinite(n) ? n : NaN;
  }

  // Método para parsear el precio del producto y verificar que es válido
  private parsePrecio(v: unknown): number | null {
    const n = this.num(v);

    return Number.isFinite(n) && n > 0 ? n : null;
  }

  // Método para calcular la distancia en kilómetros entre dos coordenadas (Haversine)
  private distancia(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const toRad = (x: number) => (x * Math.PI) / 180;

    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) ** 2;

    return 2 * R * Math.asin(Math.sqrt(a));
  }

  // Método para normalizar el nombre de la empresa 
  private normalizarEmpresa(rotuloRaw: string): string {
    const s = this.limpiarParaMatch(rotuloRaw);

    const map: [string, string][] = [
      ['REPSOL', 'REPSOL'],
      ['CEPSA', 'CEPSA'],
      ['BP', 'BP'],
      ['SHELL', 'SHELL'],
      ['GALP', 'GALP'],
      ['MOEVE', 'MOEVE'],
      ['AVIA', 'AVIA'],
      ['PLENOIL', 'PLENOIL'],
      ['PETROPRIX', 'PETROPRIX'],
      ['BALLENOIL', 'BALLENOIL'],
      ['Q8', 'Q8'],
      ['CARREFOUR', 'CARREFOUR'],
      ['EROSKI', 'EROSKI'],
      ['DISA', 'DISA'],
    ];

    for (const [k, v] of map) {
      if (s.includes(k)) return v;
    }

    return rotuloRaw?.trim() ? rotuloRaw.trim() : 'SIN MARCA';
  }

  // Método para limpiar y normalizar un string
  private limpiarParaMatch(str: string): string {
    return String(str ?? '')
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  
  // Método para forzar renderizado
  private ui(fn: () => void): void {
    this.zone.run(() => {
      fn();
      this.forzarRender();
    });
  }

  // Método para actualizar el estado de la UI de forma segura
  private setUi(
    patch: Partial<
      Pick<
        Inicio,
        'loading' | 'error' | 'info' | 'ubicacionTexto' | 'results'
      >
    >
  ): void {
    this.ui(() => Object.assign(this, patch));
  }

  // Método para forzar el renderizado del componente
  private forzarRender(): void {
    try {
      this.cdr.detectChanges();
    } catch {}
  }
}
