// Copyright Hollow Block. All Rights Reserved.

#include "Core/HLGameMode.h"
#include "Core/HLHUD.h"
#include "Player/HLCharacter.h"
#include "Player/HLPlayerController.h"
#include "Components/HLObjectiveComponent.h"

AHLGameMode::AHLGameMode()
{
	DefaultPawnClass = AHLCharacter::StaticClass();
	PlayerControllerClass = AHLPlayerController::StaticClass();
	HUDClass = AHLHUD::StaticClass();

	Objectives = CreateDefaultSubobject<UHLObjectiveComponent>(TEXT("Objectives"));
}
