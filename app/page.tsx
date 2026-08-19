import DesignSearch from "@/components/DesignSearch";
import type { Design } from "@/lib/search";
import data from "@/public/designs.json";

export default function Page() {
  const { designs, sample } = data as unknown as {
    designs: Design[];
    sample?: boolean;
  };
  return <DesignSearch designs={designs} isSample={Boolean(sample)} />;
}
