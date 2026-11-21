import { SelectInput, SubmitButton } from "@openokr/ui";
import type { PlanningSector } from "../../../lib/extension/planning.ts";
import { getTranslations } from "../../../lib/translations";

/**
 * Which sector a planning screen shows.
 *
 * A plain GET form, so the choice lives in the address: it survives a reload,
 * it can be sent to a colleague, and it works with scripting off.
 */
export async function SectorPicker({
  action,
  sectors,
  sectorId,
}: {
  /** The screen's own address, which the choice is added to. */
  readonly action: string;
  readonly sectors: readonly PlanningSector[];
  readonly sectorId: string | null;
}) {
  const { t } = await getTranslations();
  return (
    <form action={action} method="get" className="flex items-end gap-2">
      <SelectInput
        label={t("planning.sector.label")}
        name="sector"
        defaultValue={sectorId ?? ""}
        // A fixed width: the longest sector name would otherwise move
        // everything beside the menu.
        inputClassName="w-72"
      >
        {sectors.map((sector) => (
          <option key={sector.spaceId} value={sector.spaceId}>
            {sector.name}
          </option>
        ))}
      </SelectInput>
      <SubmitButton>{t("planning.sector.show")}</SubmitButton>
    </form>
  );
}
