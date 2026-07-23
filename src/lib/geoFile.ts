export type GeoGeometry = {
  type: string;
  coordinates?: unknown;
  geometries?: GeoGeometry[];
};

export type GeoFeature = {
  type: "Feature";
  geometry: GeoGeometry | null;
  properties: Record<string, unknown> | null;
};

export type GeoFeatureCollection = {
  type: "FeatureCollection";
  features: GeoFeature[];
};

const supportedGeometryTypes = new Set([
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
  "GeometryCollection",
]);

function isGeometry(value: unknown): value is GeoGeometry {
  if (!value || typeof value !== "object") return false;
  const geometry = value as GeoGeometry;
  return supportedGeometryTypes.has(geometry.type);
}

function normalizeGeoJson(value: unknown): GeoFeatureCollection {
  if (!value || typeof value !== "object") {
    throw new Error("This file does not contain valid GeoJSON.");
  }

  const geo = value as { type?: string; features?: unknown[]; geometry?: unknown; properties?: unknown };
  if (geo.type === "FeatureCollection" && Array.isArray(geo.features)) {
    const features = geo.features.filter((feature): feature is GeoFeature => {
      if (!feature || typeof feature !== "object") return false;
      const candidate = feature as GeoFeature;
      return candidate.type === "Feature" && (candidate.geometry === null || isGeometry(candidate.geometry));
    });
    if (features.length !== geo.features.length) {
      throw new Error("One or more GeoJSON features have an unsupported geometry.");
    }
    return { type: "FeatureCollection", features };
  }

  if (geo.type === "Feature" && (geo.geometry === null || isGeometry(geo.geometry))) {
    return {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        geometry: geo.geometry as GeoGeometry | null,
        properties: geo.properties && typeof geo.properties === "object"
          ? geo.properties as Record<string, unknown>
          : {},
      }],
    };
  }

  if (isGeometry(value)) {
    return {
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: value, properties: {} }],
    };
  }

  throw new Error("This JSON file is not GeoJSON.");
}

function xmlText(element: Element, tag: string) {
  return element.getElementsByTagName(tag)[0]?.textContent?.trim() || "";
}

function parseCoordinateList(value: string) {
  return value.trim().split(/\s+/).map((position) => {
    const [lng, lat, elevation] = position.split(",").map(Number);
    return Number.isFinite(elevation) ? [lng, lat, elevation] : [lng, lat];
  }).filter((position) => position.length >= 2 && position.every(Number.isFinite));
}

function parseKml(document: Document): GeoFeatureCollection {
  const features: GeoFeature[] = [];
  document.querySelectorAll("Placemark").forEach((placemark) => {
    const properties: Record<string, unknown> = {};
    const name = xmlText(placemark, "name");
    const description = xmlText(placemark, "description");
    if (name) properties.name = name;
    if (description) properties.description = description;

    const point = placemark.querySelector("Point > coordinates");
    const line = placemark.querySelector("LineString > coordinates");
    const polygon = placemark.querySelector("Polygon");
    let geometry: GeoGeometry | null = null;

    if (point?.textContent) {
      geometry = { type: "Point", coordinates: parseCoordinateList(point.textContent)[0] };
    } else if (line?.textContent) {
      geometry = { type: "LineString", coordinates: parseCoordinateList(line.textContent) };
    } else if (polygon) {
      const rings = Array.from(polygon.querySelectorAll("LinearRing > coordinates"))
        .map((node) => parseCoordinateList(node.textContent || ""));
      geometry = { type: "Polygon", coordinates: rings };
    }

    if (geometry) features.push({ type: "Feature", geometry, properties });
  });
  if (!features.length) throw new Error("No supported points, lines, or polygons were found in this KML file.");
  return { type: "FeatureCollection", features };
}

function parseGpx(document: Document): GeoFeatureCollection {
  const features: GeoFeature[] = [];
  document.querySelectorAll("wpt").forEach((point) => {
    const lat = Number(point.getAttribute("lat"));
    const lng = Number(point.getAttribute("lon"));
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lng, lat] },
        properties: { name: xmlText(point, "name") || undefined },
      });
    }
  });
  document.querySelectorAll("trkseg, rte").forEach((segment) => {
    const points = Array.from(segment.querySelectorAll("trkpt, rtept")).map((point) => [
      Number(point.getAttribute("lon")),
      Number(point.getAttribute("lat")),
    ]).filter((position) => position.every(Number.isFinite));
    if (points.length > 1) {
      features.push({ type: "Feature", geometry: { type: "LineString", coordinates: points }, properties: {} });
    }
  });
  if (!features.length) throw new Error("No waypoints, routes, or tracks were found in this GPX file.");
  return { type: "FeatureCollection", features };
}

export async function parseGeoFile(file: File): Promise<GeoFeatureCollection> {
  if (file.size > 5 * 1024 * 1024) throw new Error("Choose a map file smaller than 5 MB.");
  const extension = file.name.split(".").pop()?.toLowerCase();
  const text = await file.text();

  if (extension === "geojson" || extension === "json") {
    try {
      return normalizeGeoJson(JSON.parse(text));
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error("This file is not valid JSON.");
      throw error;
    }
  }

  if (extension === "kml" || extension === "gpx") {
    const document = new DOMParser().parseFromString(text, "application/xml");
    if (document.querySelector("parsererror")) throw new Error("This map file contains invalid XML.");
    return extension === "kml" ? parseKml(document) : parseGpx(document);
  }

  throw new Error("Supported formats are GeoJSON, JSON, KML, and GPX.");
}

export function countGeometryTypes(collection: GeoFeatureCollection) {
  return collection.features.reduce<Record<string, number>>((counts, feature) => {
    const type = feature.geometry?.type || "Empty";
    counts[type] = (counts[type] || 0) + 1;
    return counts;
  }, {});
}
