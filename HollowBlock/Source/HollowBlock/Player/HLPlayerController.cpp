// Copyright Hollow Block. All Rights Reserved.

#include "Player/HLPlayerController.h"

AHLPlayerController::AHLPlayerController()
{
	bShowMouseCursor = false;
}

void AHLPlayerController::BeginPlay()
{
	Super::BeginPlay();

	FInputModeGameOnly InputMode;
	SetInputMode(InputMode);
	bShowMouseCursor = false;
}
