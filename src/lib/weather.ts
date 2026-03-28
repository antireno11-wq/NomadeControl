type WeatherSummary = {
  temperatureMax: number | null;
  temperatureMin: number | null;
};

export async function getCampWeatherSummary(input: {
  latitude?: number | null;
  longitude?: number | null;
  date: string;
}): Promise<WeatherSummary | null> {
  const { latitude, longitude, date } = input;

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
