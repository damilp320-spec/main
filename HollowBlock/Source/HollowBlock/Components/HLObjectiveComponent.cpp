// Copyright Hollow Block. All Rights Reserved.

#include "Components/HLObjectiveComponent.h"

UHLObjectiveComponent::UHLObjectiveComponent()
{
	PrimaryComponentTick.bCanEverTick = false;
}

void UHLObjectiveComponent::BeginPlay()
{
	Super::BeginPlay();

	if (Objectives.Num() == 0)
	{
		// Sensible default arc so the component is playable before designers fill it in.
		Objectives = {
			FText::FromString(TEXT("Find a way out of the block")),
			FText::FromString(TEXT("Restore power to the stairwell")),
			FText::FromString(TEXT("Find the rooftop access key")),
			FText::FromString(TEXT("Reach the rooftop"))
		};
	}

	OnObjectiveChanged.Broadcast(GetCurrentObjectiveText());
}

void UHLObjectiveComponent::CompleteCurrentObjective()
{
	if (IsComplete())
	{
		return;
	}

	++CurrentIndex;

	if (IsComplete())
	{
		OnObjectiveChanged.Broadcast(FText::GetEmpty());
		OnAllObjectivesComplete.Broadcast();
	}
	else
	{
		OnObjectiveChanged.Broadcast(GetCurrentObjectiveText());
	}
}

bool UHLObjectiveComponent::CompleteObjectiveByTag(FName Tag)
{
	if (IsComplete() || !ObjectiveTags.IsValidIndex(CurrentIndex))
	{
		return false;
	}

	if (ObjectiveTags[CurrentIndex] != Tag)
	{
		return false;
	}

	CompleteCurrentObjective();
	return true;
}

FText UHLObjectiveComponent::GetCurrentObjectiveText() const
{
	return Objectives.IsValidIndex(CurrentIndex) ? Objectives[CurrentIndex] : FText::GetEmpty();
}

float UHLObjectiveComponent::GetProgressFraction() const
{
	return Objectives.Num() > 0 ? static_cast<float>(CurrentIndex) / static_cast<float>(Objectives.Num()) : 0.f;
}
