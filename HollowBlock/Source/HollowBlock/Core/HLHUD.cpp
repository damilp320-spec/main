// Copyright Hollow Block. All Rights Reserved.

#include "Core/HLHUD.h"
#include "Core/HLGameMode.h"
#include "Player/HLCharacter.h"
#include "Components/HLFlashlightComponent.h"
#include "Components/HLComposureComponent.h"
#include "Components/HLObjectiveComponent.h"
#include "Interaction/HLInteractableInterface.h"

namespace
{
	AHLCharacter* GetHLCharacter(const AHLHUD* HUD)
	{
		return HUD ? Cast<AHLCharacter>(HUD->GetOwningPawn()) : nullptr;
	}
}

FText AHLHUD::GetCurrentInteractionPrompt() const
{
	if (const AHLCharacter* Char = GetHLCharacter(this))
	{
		if (AActor* Focus = Char->GetFocusedInteractable())
		{
			if (Focus->Implements<UHLInteractableInterface>())
			{
				return IHLInteractableInterface::Execute_GetInteractText(Focus);
			}
		}
	}
	return FText::GetEmpty();
}

float AHLHUD::GetBatteryPercent() const
{
	if (const AHLCharacter* Char = GetHLCharacter(this))
	{
		if (const UHLFlashlightComponent* FL = Char->GetFlashlight())
		{
			return FL->GetBatteryPercent();
		}
	}
	return 0.f;
}

float AHLHUD::GetComposurePercent() const
{
	if (const AHLCharacter* Char = GetHLCharacter(this))
	{
		if (const UHLComposureComponent* Comp = Char->GetComposure())
		{
			return Comp->GetComposurePercent();
		}
	}
	return 1.f;
}

FText AHLHUD::GetObjectiveText() const
{
	if (const AHLGameMode* GM = GetWorld() ? GetWorld()->GetAuthGameMode<AHLGameMode>() : nullptr)
	{
		if (const UHLObjectiveComponent* Obj = GM->GetObjectives())
		{
			return Obj->GetCurrentObjectiveText();
		}
	}
	return FText::GetEmpty();
}
