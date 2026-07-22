import * as Location from 'expo-location';

const TIMEOUT_MS = 5000;

export interface Coords {
  lat: number;
  lng: number;
}

// 完了/不在タップ時にのみ呼ぶ（常時追跡はしない）。
// 権限拒否・取得失敗・5秒タイムアウトのいずれでも null を返し、呼び出し元の記録処理を止めない
// （GPSはMVPの必須条件ではない＝「押した完了が消えない」ことのほうが命綱）。
export async function getCurrentCoords(): Promise<Coords | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;

    const timeout = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), TIMEOUT_MS);
    });
    const position = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      timeout,
    ]);
    if (!position) return null;
    return { lat: position.coords.latitude, lng: position.coords.longitude };
  } catch {
    return null;
  }
}
