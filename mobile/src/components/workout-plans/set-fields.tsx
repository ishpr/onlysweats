import { View } from "react-native";
import { Chip, Field, Row } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import type { SetFields as Fields } from "@/lib/workout-plans/forms";

export function SetFields({
  value,
  onChange,
  performed = false,
  disabled = false,
}: {
  value: Fields;
  onChange: (patch: Partial<Fields>) => void;
  performed?: boolean;
  disabled?: boolean;
}) {
  return (
    <View style={{ gap: Spacing.two }}>
      <Row style={{ alignItems: "flex-start" }}>
        <View style={{ flex: 1 }}>
          <Field
            label={performed ? "Actual reps" : "Target reps"}
            value={value.reps}
            onChangeText={(reps) => onChange({ reps })}
            keyboardType="number-pad"
            maxLength={4}
            editable={!disabled}
            placeholder="Optional"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label={performed ? "Actual seconds" : "Target seconds"}
            value={value.durationSeconds}
            onChangeText={(durationSeconds) => onChange({ durationSeconds })}
            keyboardType="number-pad"
            maxLength={5}
            editable={!disabled}
            placeholder="Optional"
          />
        </View>
      </Row>
      <Field
        label={performed ? "Actual distance (meters)" : "Target distance (meters)"}
        value={value.distanceMeters}
        onChangeText={(distanceMeters) => onChange({ distanceMeters })}
        keyboardType="decimal-pad"
        maxLength={10}
        editable={!disabled}
        placeholder="Optional"
      />
      <Row style={{ flexWrap: "wrap" }}>
        {(["kg", "lb", "bodyweight"] as const).map((unit) => (
          <Chip
            key={unit}
            label={unit === "bodyweight" ? "Bodyweight" : unit}
            selected={value.unit === unit}
            disabled={disabled}
            onPress={() => onChange({ unit, ...(unit === "bodyweight" ? { weight: "" } : {}) })}
          />
        ))}
      </Row>
      {value.unit !== "bodyweight" && (
        <Field
          label={performed ? `Actual load (${value.unit})` : `Planned load (${value.unit})`}
          value={value.weight}
          onChangeText={(weight) => onChange({ weight })}
          keyboardType="decimal-pad"
          maxLength={8}
          editable={!disabled}
          placeholder="Leave blank if unspecified"
        />
      )}
      {!performed && (
        <Field
          label="Rest after this set (seconds)"
          value={value.restSeconds}
          onChangeText={(restSeconds) => onChange({ restSeconds })}
          keyboardType="number-pad"
          maxLength={4}
          editable={!disabled}
        />
      )}
    </View>
  );
}
