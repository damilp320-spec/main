// Copyright Hollow Block. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "HLGameMode.generated.h"

/**
 * Default game mode for Hollow Block. Wires the C++ player pawn, controller and HUD
 * as defaults so a freshly created map plays correctly. The objective component is
 * carried on the player state-agnostic GameMode here so any actor can query progress.
 */
UCLASS()
class HOLLOWBLOCK_API AHLGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	AHLGameMode();

	UFUNCTION(BlueprintPure, Category = "HollowBlock")
	class UHLObjectiveComponent* GetObjectives() const { return Objectives; }

protected:
	/** Run-wide objective tracker. Lives on the GameMode so it survives pawn changes. */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "HollowBlock")
	TObjectPtr<class UHLObjectiveComponent> Objectives;
};
