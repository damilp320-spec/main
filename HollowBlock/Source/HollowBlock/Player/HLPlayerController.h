// Copyright Hollow Block. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/PlayerController.h"
#include "HLPlayerController.generated.h"

/**
 * Player controller for Hollow Block. Forces mouse cursor off and locks input to
 * the game so the first-person experience stays immersive. Enhanced Input mapping
 * contexts are added by the possessed AHLCharacter; this controller just sets up
 * the input mode and exists as a Blueprintable hook for pause / menu logic.
 */
UCLASS()
class HOLLOWBLOCK_API AHLPlayerController : public APlayerController
{
	GENERATED_BODY()

public:
	AHLPlayerController();

protected:
	virtual void BeginPlay() override;
};
