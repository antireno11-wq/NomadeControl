type WeatherSummary = {
  temperatureMax: number | null;
  temperatureMin: number | null;
};

type Coordinates = {
  latitude: number;
  longitude: number;
};

export async function geocodeLocation(location?: string | null): Promise<Coordinates | null> {
  if (!location?.trim()) {
    return null;
  }

  const params = new URLSearchParams({
    name: location,
    count: "1",
    language: "es",
    format: "json"
  });

  try {
    const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`, {
      next: { revalidate: 60 * 60 * 24 }
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      results?: Array<{ latitude: number; longitude: number }>;
    };

    const firstMatch = payload.results?.[0];
    if (!firstMatch) {
      return null;
    }

    return {
      latitude: firstMatch.latitude,
      longitude: firstMatch.longitude
    };
  } catch {
    return null;
  }
}

export async function getCampWeatherSummary(input: {
  latitude?: number | null;
  longitude?: number | null;
  location?: string | null;
  date: string;
}): Promise<WeatherSummary | null> {
  let { latitude, longitude } = input;
  const { date, location } = input;

  if (latitude == null || longitude == null) {
    const resolvedCoordinates = await geocodeLocation(location);
    latitude = resolvedCoordinates?.latitude ?? null;
    longitude = resolvedCoordinates?.longitude ?? null;
  }

  if (latitude == null || longitude == null) {
    return null;
  }

  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    start_date: date,
    end_date: date,
    daily: "temperature_2m_max,temperature_2m_min",
    timezone: "auto"
  });

  try {
    const response = await fetch(`https://archive-api.open-meteo.com/v1/archive?${params.toString()}`, {
      next: { revalidate: 60 * 60 * 6 }
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      daily?: {
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
      };
    };

    return {
      temperatureMax: payload.daily?.temperature_2m_max?.[0] ?? null,
      temperatureMin: payload.daily?.temperature_2m_min?.[0] ?? null
    };
  } catch {
    return null;
  }
}
