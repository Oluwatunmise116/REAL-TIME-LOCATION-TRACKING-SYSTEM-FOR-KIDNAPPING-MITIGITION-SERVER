import { Suspense } from "react";
import { DeviceDetail } from "@/components/devices/device-detail";

async function Detail({ params }: { params: PageProps<"/devices/[id]">["params"] }) {
  const { id } = await params;
  const deviceId = decodeURIComponent(id);
  return <DeviceDetail key={deviceId} id={deviceId} />;
}

// The device id is request data, so it streams in behind a boundary; the shell prerenders.
export default function DevicePage({ params }: PageProps<"/devices/[id]">) {
  return (
    <Suspense>
      <Detail params={params} />
    </Suspense>
  );
}
