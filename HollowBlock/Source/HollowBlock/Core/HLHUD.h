// Copyright Hollow Block. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/HUD.h"
#include "HLHUD.generated.h"

/**
 * Minimal native HUD that surfaces the data a UMG widget needs (battery, composure,
 * current objective, interaction prompt). The intent is that a designer creates a
 * UMG widget in-editor and binds it to these BlueprintImplementableEvents, or a
 * Blueprint child of this HUD adds the widget to the viewport. Kept thin on purpose
 * so visuals are authored in the editor, not in C++.
 */
UCLASS()
class HOLLOWBLOCK_API AHLHUD : public AHUD
{
	GENERATED_BODY()

public:
	/** Current interaction prompt, or empty when nothing is focused. */
	UFUNCTION(BlueprintPure, Category = "HollowBlock|HUD")
	FText GetCurrentInteractionPrompt() const;

	/** 0..1 flashlight battery, for binding to a UMG progress bar. */
	UFUNCTION(BlueprintPure, Category = "HollowBlock|HUD")
	float GetBatteryPercent() const;

	/** 0..1 composure, for vignette / heartbeat intensity in UMG. */
	UFUNCTION(BlueprintPure, Category = "HollowBlock|HUD")
	float GetComposurePercent() const;

	/** Current objective text from the GameMode's objective component. */
	UFUNCTION(BlueprintPure, Category = "HollowBlock|HUD")
	FText GetObjectiveText() const;
};
