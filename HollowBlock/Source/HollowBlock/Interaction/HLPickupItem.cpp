// Copyright Hollow Block. All Rights Reserved.

#include "Interaction/HLPickupItem.h"
#include "Components/StaticMeshComponent.h"
#include "Player/HLCharacter.h"
#include "Components/HLFlashlightComponent.h"

AHLPickupItem::AHLPickupItem()
{
	PrimaryActorTick.bCanEverTick = false;

	Mesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Mesh"));
	RootComponent = Mesh;
}

void AHLPickupItem::Interact_Implementation(AActor* Interactor)
{
	if (AHLCharacter* Char = Cast<AHLCharacter>(Interactor))
	{
		if (ItemType == EHLItemType::Battery)
		{
			if (UHLFlashlightComponent* FL = Char->GetFlashlight())
			{
				FL->AddBattery(BatteryRestoreFraction);
			}
		}
		else if (ItemType == EHLItemType::KeyItem)
		{
			Char->AddKey(ItemTag);
		}
	}

	OnItemPickedUp.Broadcast(ItemType, ItemTag);
	Destroy();
}

FText AHLPickupItem::GetInteractText_Implementation() const
{
	if (!PickupPrompt.IsEmpty())
	{
		return PickupPrompt;
	}
	return ItemType == EHLItemType::Battery
		? FText::FromString(TEXT("Take batteries"))
		: FText::FromString(TEXT("Take item"));
}
